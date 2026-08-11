from accounts.tokens import ACCESS_COOKIE_NAME, issue_tokens_for_user

# Every unsafe-method request this API accepts requires this header (see
# accounts/csrf.py) -- matches accounts/tests/helpers.py's AJAX_HEADERS.
AJAX_HEADERS = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


def login_as(client, user):
    """Authenticates `client` as `user` for the `CookieJWTAuthentication`
    seam (accounts/authentication.py) by setting the access-token cookie
    directly, bypassing the throttled `/auth/login` endpoint -- this
    app's own tests only need a valid session, not to re-exercise login
    itself (accounts' own tests already cover that)."""
    access_token, _refresh_token = issue_tokens_for_user(user)
    client.cookies[ACCESS_COOKIE_NAME] = access_token
