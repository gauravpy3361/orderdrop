import urllib.request
import urllib.error
import json
import ssl
import sys

base = 'https://orderdrop.store'
ctx = ssl.create_default_context()

def check(name, url, method='GET', data=None, headers=None, expected_status=200):
    if headers is None:
        headers = {}
    headers['User-Agent'] = 'OrderDrop-Production-Audit/2.0'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            body = resp.read().decode('utf-8', errors='ignore')
            success = (resp.status == expected_status)
            status_label = 'PASS' if success else 'FAIL'
            print(f'[{status_label}] {name} -> Got HTTP {resp.status}, Expected {expected_status}')
            return success, resp.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='ignore')
        success = (e.code == expected_status)
        status_label = 'PASS' if success else 'FAIL'
        print(f'[{status_label}] {name} -> Got HTTP {e.code}, Expected {expected_status}')
        return success, e.code, body
    except Exception as e:
        print(f'[FAIL] {name} -> Exception: {e}')
        return False, None, str(e)

print('=======================================================')
print('   ORDERDROP PRODUCTION VERIFICATION & SECURITY AUDIT   ')
print('=======================================================')
results = []

# 1. Health endpoint (HTTP 200)
results.append(check('1. Health Check Endpoint', f'{base}/health', expected_status=200))

# 2. Public Landing Page (HTTP 200)
results.append(check('2. Public Landing Page / Marketing Portal', f'{base}/', expected_status=200))

# 3. Privacy Policy (HTTP 200)
results.append(check('3. Privacy Policy Page (Shopify Requirement)', f'{base}/privacy', expected_status=200))

# 4. Terms of Service (HTTP 200)
results.append(check('4. Terms of Service Page (Shopify Requirement)', f'{base}/terms', expected_status=200))

# 5. Auth validation: Missing shop parameter (HTTP 400)
results.append(check('5. Auth Missing Shop Param', f'{base}/auth', expected_status=400))

# 6. Auth validation: SSRF / Invalid shop domain (HTTP 400)
results.append(check('6. Auth SSRF Defense (evil.com)', f'{base}/auth?shop=evil.com', expected_status=400))
results.append(check('7. Auth SSRF Defense (*.myshopify.com.evil.com)', f'{base}/auth?shop=my-store.myshopify.com.evil.com', expected_status=400))

# 7. OAuth Callback: Missing HMAC / State (HTTP 400)
results.append(check('8. OAuth Callback Missing HMAC Signature', f'{base}/auth/callback?shop=test.myshopify.com&code=123', expected_status=400))

# 8. API Settings: Missing token / Unauthorized access (HTTP 401)
post_data = json.dumps({'shop': 'test-shop.myshopify.com', 'recipientEmail': 'hacker@evil.com'}).encode('utf-8')
results.append(check('9. API Settings Unauthorized Modification Defense', f'{base}/api/settings', method='POST', data=post_data, headers={'Content-Type': 'application/json'}, expected_status=401))

# 9. API Export: Missing session token (HTTP 401)
results.append(check('10. API Export Unauthorized Order Manifest Download', f'{base}/api/export?shop=test-shop.myshopify.com', expected_status=401))

# 10. API Send Email: Missing session token (HTTP 401)
email_data = json.dumps({'shop': 'test-shop.myshopify.com'}).encode('utf-8')
results.append(check('11. API Instant Dispatch Unauthorized Trigger Defense', f'{base}/api/send-email', method='POST', data=email_data, headers={'Content-Type': 'application/json'}, expected_status=401))

# 11. Webhooks: Missing HMAC signatures (HTTP 401)
webhook_body = json.dumps({'shop_domain': 'test.myshopify.com'}).encode('utf-8')
results.append(check('12. Webhook: customers/data_request Missing HMAC', f'{base}/webhooks/customers/data_request', method='POST', data=webhook_body, headers={'Content-Type': 'application/json'}, expected_status=401))
results.append(check('13. Webhook: customers/redact Missing HMAC', f'{base}/webhooks/customers/redact', method='POST', data=webhook_body, headers={'Content-Type': 'application/json'}, expected_status=401))
results.append(check('14. Webhook: shop/redact Missing HMAC', f'{base}/webhooks/shop/redact', method='POST', data=webhook_body, headers={'Content-Type': 'application/json'}, expected_status=401))
results.append(check('15. Webhook: app/uninstalled Missing HMAC', f'{base}/webhooks/app/uninstalled', method='POST', data=webhook_body, headers={'Content-Type': 'application/json'}, expected_status=401))

# 12. Dashboard Auth Bypass & Session Token Leak Defense (HTTP 401)
results.append(check('16. Dashboard Unauthenticated Shop Impersonation Defense', f'{base}/?shop=hk-mart-cfoepmjd.myshopify.com', expected_status=401))

# 13. Billing Endpoints Auth Defense (HTTP 401)
results.append(check('17. Billing Subscribe Unauthorized Access Defense', f'{base}/api/billing/subscribe?shop=hk-mart-cfoepmjd.myshopify.com&plan=annual', expected_status=401))
results.append(check('18. Billing Confirm Free-Upgrade Spoofing Defense', f'{base}/api/billing/confirm?shop=hk-mart-cfoepmjd.myshopify.com&plan=annual', expected_status=401))

total = len(results)
passed = sum(1 for r in results if r[0])
print('=======================================================')
print(f'   AUDIT SUMMARY: {passed}/{total} CHECKS PASSED')
print('=======================================================')

if passed < total:
    sys.exit(1)
