import {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  randomState,
  randomPKCECodeVerifier,
  ClientSecretPost,
} from 'openid-client';
import { Router } from 'express';
import axios from 'axios';
import crypto from 'node:crypto';
import { cloudServerUrl, serverAppId } from '../Utils.js';

function pkceChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest()
    .toString('base64url');
}

const router = Router();

const OIDC_ENABLED = process.env.OIDC_ENABLED === 'true';
const OIDC_ISSUER = process.env.OIDC_ISSUER;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const OIDC_REDIRECT_URI =
  process.env.OIDC_REDIRECT_URI || 'http://localhost:8080/auth/oidc/callback';
const OIDC_FRONTEND_REDIRECT =
  process.env.OIDC_FRONTEND_REDIRECT || 'http://localhost:3000/login';
const OIDC_ADMIN_AUTO_PROVISION = process.env.OIDC_ADMIN_AUTO_PROVISION === 'true';
const OIDC_ADMIN_DOMAIN = process.env.OIDC_ADMIN_DOMAIN || '';
const OIDC_SCOPES = process.env.OIDC_SCOPES || 'openid email profile offline_access';
const APPID = serverAppId;
const masterKEY = process.env.MASTER_KEY;
const serverUrl = cloudServerUrl;

let oidcConfigPromise = null;

function isEnabled() {
  return OIDC_ENABLED && OIDC_ISSUER && OIDC_CLIENT_ID;
}

function getConfig() {
  if (!isEnabled()) {
    throw new Error('OIDC is not configured');
  }
  if (!oidcConfigPromise) {
    const issuerUrl = new URL(OIDC_ISSUER);
    const clientAuth = OIDC_CLIENT_SECRET ? ClientSecretPost(OIDC_CLIENT_SECRET) : undefined;
    oidcConfigPromise = discovery(
      issuerUrl,
      OIDC_CLIENT_ID,
      { redirect_uris: [OIDC_REDIRECT_URI] },
      clientAuth
    );
  }
  return oidcConfigPromise;
}

function cookieOptions(maxAge) {
  const isSecure = OIDC_REDIRECT_URI.startsWith('https://');
  return {
    httpOnly: true,
    path: '/',
    maxAge,
    sameSite: 'Lax',
    secure: isSecure,
  };
}

async function createSessionToken(userId) {
  const url = `${serverUrl}/loginAs`;
  const res = await axios({
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': APPID,
      'X-Parse-Master-Key': masterKEY,
    },
    params: { userId },
  });
  return res.data;
}

async function findOrCreateAdminUser(email, name) {
  const normalizedEmail = email.toLowerCase().replace(/\s/g, '');

  // 1. Find existing _User by email.
  const userQuery = new Parse.Query(Parse.User);
  userQuery.equalTo('email', normalizedEmail);
  let user = await userQuery.first({ useMasterKey: true });

  if (user) {
    // 2. Existing user: check if they are an admin.
    const extQuery = new Parse.Query('contracts_Users');
    extQuery.equalTo('UserId', {
      __type: 'Pointer',
      className: '_User',
      objectId: user.id,
    });
    const extUser = await extQuery.first({ useMasterKey: true });

    if (extUser) {
      const role = extUser.get('UserRole');
      if (role === 'contracts_Admin') {
        return user;
      }
      throw new Error('SSO login is restricted to admin users.');
    }

    // Existing _User but no contracts_Users. If auto-provision is enabled and
    // domain matches (if configured), create admin record.
    if (!OIDC_ADMIN_AUTO_PROVISION) {
      throw new Error('SSO login is restricted to admin users.');
    }
    if (OIDC_ADMIN_DOMAIN && !normalizedEmail.endsWith(`@${OIDC_ADMIN_DOMAIN}`)) {
      throw new Error('Email domain is not authorized for admin provisioning.');
    }

    return await provisionAdmin(user, normalizedEmail, name);
  }

  // 3. No existing user.
  if (!OIDC_ADMIN_AUTO_PROVISION) {
    throw new Error('SSO login is restricted to admin users.');
  }
  if (OIDC_ADMIN_DOMAIN && !normalizedEmail.endsWith(`@${OIDC_ADMIN_DOMAIN}`)) {
    throw new Error('Email domain is not authorized for admin provisioning.');
  }

  // 4. Create new _User and admin profile.
  const newUser = new Parse.User();
  newUser.set('username', normalizedEmail);
  newUser.set('password', crypto.randomUUID());
  newUser.set('email', normalizedEmail);
  newUser.set('normalizedEmail', normalizedEmail);
  newUser.set('name', name || normalizedEmail);
  await newUser.signUp(null, { useMasterKey: true });
  return await provisionAdmin(newUser, normalizedEmail, name);
}

async function provisionAdmin(user, email, name) {
  // Check if contracts_Users already exists (edge case).
  const extQuery = new Parse.Query('contracts_Users');
  extQuery.equalTo('UserId', {
    __type: 'Pointer',
    className: '_User',
    objectId: user.id,
  });
  const existingExt = await extQuery.first({ useMasterKey: true });
  if (existingExt) {
    existingExt.set('UserRole', 'contracts_Admin');
    await existingExt.save(null, { useMasterKey: true });
    return user;
  }

  // Create tenant.
  const tenant = new Parse.Object('partners_Tenant');
  tenant.set('UserId', {
    __type: 'Pointer',
    className: '_User',
    objectId: user.id,
  });
  tenant.set('EmailAddress', email);
  tenant.set('TenantName', name || email);
  tenant.set('IsActive', true);
  tenant.set('CreatedBy', {
    __type: 'Pointer',
    className: '_User',
    objectId: user.id,
  });
  const tenantRes = await tenant.save(null, { useMasterKey: true });

  // Create extended admin user.
  const extUser = new Parse.Object('contracts_Users');
  extUser.set('UserId', {
    __type: 'Pointer',
    className: '_User',
    objectId: user.id,
  });
  extUser.set('UserRole', 'contracts_Admin');
  extUser.set('Email', email);
  extUser.set('Name', name || email);
  extUser.set('TenantId', {
    __type: 'Pointer',
    className: 'partners_Tenant',
    objectId: tenantRes.id,
  });
  await extUser.save(null, { useMasterKey: true });

  return user;
}

router.get('/login', async (req, res) => {
  try {
    const config = await getConfig();
    const codeVerifier = randomPKCECodeVerifier();
    const state = randomState();

    const authorizationUrl = buildAuthorizationUrl(config, {
      scope: OIDC_SCOPES,
      code_challenge: pkceChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      redirect_uri: OIDC_REDIRECT_URI,
    });

    res.cookie('oidc_state', state, cookieOptions(600000));
    res.cookie('oidc_verifier', codeVerifier, cookieOptions(600000));
    res.redirect(authorizationUrl.toString());
  } catch (error) {
    console.error('OIDC login error:', error);
    res.redirect(`${OIDC_FRONTEND_REDIRECT}?error=oidc_configuration_error`);
  }
});

router.get('/callback', async (req, res) => {
  const state = req.cookies?.oidc_state;
  const codeVerifier = req.cookies?.oidc_verifier;

  res.clearCookie('oidc_state', { path: '/' });
  res.clearCookie('oidc_verifier', { path: '/' });

  try {
    const config = await getConfig();
    const currentUrl = new URL(`${OIDC_REDIRECT_URI}?${new URLSearchParams(req.query).toString()}`);
    const tokenSet = await authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
    });

    const claims = tokenSet.claims();
    const email = claims?.email;
    const name = claims?.name || claims?.preferred_username || email;

    if (!email) {
      throw new Error('OIDC provider did not return an email claim.');
    }

    const user = await findOrCreateAdminUser(email, name);
    const session = await createSessionToken(user.id);

    res.redirect(`${OIDC_FRONTEND_REDIRECT}?sessionToken=${session.sessionToken}`);
  } catch (error) {
    console.error('OIDC callback error:', error);
    const message = encodeURIComponent(error.message || 'SSO login failed');
    res.redirect(`${OIDC_FRONTEND_REDIRECT}?error=oidc_login_failed&error_description=${message}`);
  }
});

export function oidcRouter() {
  return router;
}

export function oidcConfigured() {
  return isEnabled();
}
