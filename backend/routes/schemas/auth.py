from pydantic import BaseModel, Field


class AuthDashboardRequest(BaseModel):
    token: str = Field(..., description="Cloudflare Turnstile response token")
    client_pubkey: str = Field(..., description="Client public key to validate via Turnstile cdata")


class AuthDashboardResponse(BaseModel):
    server_pubkey: str
    salt: str = Field(..., description="Base64URL-encoded salt for HKDF.")
    sid: str = Field(..., description="The generated session ID (SID).")
    ttl: int = Field(..., description="Sliding window time-to-live for the session in milliseconds.")


class AuthChartWorkerRequest(BaseModel):
    token: str = Field(..., description="Cloudflare Turnstile token.")
    client_pubkey: str = Field(..., description="Base64URL-encoded client's ephemeral public key for the worker.")


class AuthChartWorkerResponse(BaseModel):
    server_pubkey: str = Field(..., description="Base64URL-encoded server's ephemeral public key for the worker.")
    salt: str = Field(..., description="Base64URL-encoded salt for HKDF for the worker.")
    ttl: int = Field(..., description="Time-to-live for the worker keys in milliseconds.")


class AIAssetsKeyResponse(BaseModel):
    """Response model for the AI assets encryption key."""
    encrypted_key: str = Field(..., description="Base64url-encoded encrypted key with IV for AI assets.")