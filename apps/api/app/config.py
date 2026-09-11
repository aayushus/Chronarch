import os

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "480"))

# Public origin the browser uses to reach this deployment — used to build
# OAuth redirect URIs (must exactly match what's registered with the
# provider) and where the OAuth callback sends the browser back to.
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")
