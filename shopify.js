const crypto = require('crypto');

const API_VERSION = '2024-10';

/**
 * Strict validation of Shopify store domain to prevent SSRF and injection
 */
function isValidShopDomain(shop) {
  if (typeof shop !== 'string') return false;
  const clean = shop.toLowerCase().trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(clean);
}

/**
 * Verify HMAC on incoming Shopify query params using timing-safe comparison
 */
function verifyHmac(query, apiSecret) {
  if (!query || !query.hmac || !apiSecret) return false;

  const { hmac, signature, ...rest } = query;
  const orderedParams = Object.keys(rest)
    .sort()
    .map(key => `${key}=${Array.isArray(rest[key]) ? rest[key].join(',') : rest[key]}`)
    .join('&');

  const calculatedHmac = crypto
    .createHmac('sha256', apiSecret)
    .update(orderedParams)
    .digest('hex');

  try {
    const a = Buffer.from(calculatedHmac, 'utf8');
    const b = Buffer.from(hmac, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (err) {
    return false;
  }
}

/**
 * Verify Webhook HMAC from X-Shopify-Hmac-Sha256 header
 */
function verifyWebhookHmac(rawBody, headerHmac, apiSecret) {
  if (!rawBody || !headerHmac || !apiSecret) return false;
  const calculatedHmac = crypto
    .createHmac('sha256', apiSecret)
    .update(rawBody, 'utf8')
    .digest('base64');

  try {
    const a = Buffer.from(calculatedHmac, 'utf8');
    const b = Buffer.from(headerHmac, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (err) {
    return false;
  }
}

/**
 * Create a cryptographic session signature for in-dashboard client API calls
 */
function createSessionToken(shop, apiSecret, ttlMs = 24 * 60 * 60 * 1000) {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${shop}:${expiresAt}`;
  const sig = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
  return `${expiresAt}.${sig}`;
}

/**
 * Verify cryptographic session token for dashboard API actions
 */
function verifySessionToken(token, shop, apiSecret) {
  if (!token || !shop || !apiSecret) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [expiresAtStr, sig] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  const expectedSig = crypto
    .createHmac('sha256', apiSecret)
    .update(`${shop}:${expiresAtStr}`)
    .digest('hex');

  try {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

/**
 * Exchange temporary authorization code for an offline Shopify access token
 */
async function exchangeCodeForToken(shop, code, clientId, clientSecret) {
  if (!isValidShopDomain(shop)) {
    throw new Error(`Security validation failed: Invalid shop domain "${shop}"`);
  }

  const url = `https://${shop}/admin/oauth/access_token`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: code
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OAuth token exchange failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    scope: data.scope
  };
}

/**
 * Fetch real unfulfilled orders with GraphQL cursor pagination (up to 250 orders)
 */
async function fetchUnfulfilledOrders(shop, accessToken, maxOrders = 250) {
  const query = `
    query getUnfulfilledOrders($cursor: String) {
      orders(first: 50, after: $cursor, query: "fulfillment_status:unfulfilled", sortKey: CREATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            name
            createdAt
            displayFulfillmentStatus
            customer {
              displayName
              email
            }
            shippingAddress {
              formatted
            }
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 25) {
              edges {
                node {
                  title
                  sku
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  let cursor = null;
  let hasNext = true;
  const rawOrders = [];

  while (hasNext && rawOrders.length < maxOrders) {
    const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify({ query, variables: { cursor } })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Shopify GraphQL error (${response.status}): ${errText}`);
    }

    const result = await response.json();
    if (result.errors) {
      throw new Error(`GraphQL query error: ${JSON.stringify(result.errors)}`);
    }

    const connection = result.data?.orders;
    const edges = connection?.edges || [];
    rawOrders.push(...edges);

    hasNext = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = connection?.pageInfo?.endCursor || null;

    if (!cursor || edges.length === 0) break;
  }

  const normalizedRows = [];

  rawOrders.forEach(edge => {
    const order = edge.node;
    const orderName = order.name || 'Order';
    const date = (order.createdAt || new Date().toISOString()).split('T')[0];
    const customer = order.customer?.displayName || 'Guest Customer';
    const email = order.customer?.email || 'N/A';
    const status = order.displayFulfillmentStatus || 'UNFULFILLED';
    const currency = order.totalPriceSet?.shopMoney?.currencyCode || 'USD';
    const totalAmount = order.totalPriceSet?.shopMoney?.amount || '0.00';
    const orderTotal = `${currency} ${totalAmount}`;
    const address = Array.isArray(order.shippingAddress?.formatted)
      ? order.shippingAddress.formatted.join(', ')
      : 'No shipping address provided';

    const items = order.lineItems?.edges || [];
    if (items.length === 0) {
      normalizedRows.push({
        name: orderName,
        date: date,
        customer: customer,
        email: email,
        sku: 'N/A',
        item: 'No item details',
        qty: 1,
        unitPrice: orderTotal,
        total: orderTotal,
        status: status,
        address: address
      });
    } else {
      items.forEach(itemEdge => {
        const item = itemEdge.node;
        const itemUnitPrice = item.originalUnitPriceSet?.shopMoney?.amount || '0.00';
        normalizedRows.push({
          name: orderName,
          date: date,
          customer: customer,
          email: email,
          sku: item.sku || 'N/A',
          item: item.title || 'Untitled Item',
          qty: item.quantity || 1,
          unitPrice: `${currency} ${itemUnitPrice}`,
          total: orderTotal,
          status: status,
          address: address
        });
      });
    }
  });

  return normalizedRows;
}

/**
 * Create a recurring Shopify App Subscription (Monthly $9.99 or Annual $99.99) via GraphQL
 * Includes 7-day free trial
 */
async function createAppSubscription(shop, accessToken, returnUrl, isTest = null, planType = 'monthly') {
  if (!isValidShopDomain(shop)) {
    throw new Error(`Security validation failed: Invalid shop domain "${shop}"`);
  }

  const isAnnual = planType === 'annual';
  const testFlag = isTest !== null 
    ? Boolean(isTest) 
    : (process.env.SHOPIFY_BILLING_TEST === 'true' || process.env.NODE_ENV !== 'production');

  const mutation = `
    mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int!, $test: Boolean!, $price: Decimal!, $interval: AppPricingInterval!) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        trialDays: $trialDays,
        test: $test,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: $price, currencyCode: USD },
                interval: $interval
              }
            }
          }
        ]
      ) {
        userErrors {
          field
          message
        }
        confirmationUrl
        appSubscription {
          id
          status
        }
      }
    }
  `;

  const variables = {
    name: isAnnual ? 'OrderDrop Annual Plan (2 Months Free)' : 'OrderDrop Monthly Plan',
    returnUrl: returnUrl,
    trialDays: 7,
    test: testFlag,
    price: isAnnual ? '99.99' : '9.99',
    interval: isAnnual ? 'ANNUAL' : 'EVERY_30_DAYS'
  };

  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify({ query: mutation, variables })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Shopify Billing API error (${response.status}): ${errText}`);
  }

  const result = await response.json();
  const subData = result.data?.appSubscriptionCreate;

  if (subData?.userErrors && subData.userErrors.length > 0) {
    throw new Error(`Billing error: ${subData.userErrors.map(e => e.message).join(', ')}`);
  }

  return {
    confirmationUrl: subData?.confirmationUrl,
    subscriptionId: subData?.appSubscription?.id,
    status: subData?.appSubscription?.status
  };
}

/**
 * Check if the store currently has an active recurring subscription
 */
async function checkActiveSubscription(shop, accessToken) {
  const query = `
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
        }
      }
    }
  `;

  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) return { hasActiveSubscription: false, subscriptions: [] };

  const result = await response.json();
  const activeSubs = result.data?.currentAppInstallation?.activeSubscriptions || [];
  return {
    hasActiveSubscription: activeSubs.length > 0,
    subscriptions: activeSubs
  };
}

module.exports = {
  isValidShopDomain,
  verifyHmac,
  verifyWebhookHmac,
  createSessionToken,
  verifySessionToken,
  exchangeCodeForToken,
  fetchUnfulfilledOrders,
  createAppSubscription,
  checkActiveSubscription
};
