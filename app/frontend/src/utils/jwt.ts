// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/**
 * Simple JWT generation utility for frontend authentication
 * This creates a basic JWT token compatible with the backend's expected format
 */

// Base64 URL encoding (without padding)
function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Create HMAC SHA256 signature using Web Crypto API
async function createSignature(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const signatureArray = new Uint8Array(signature);
  const signatureString = String.fromCharCode(...signatureArray);
  return base64UrlEncode(signatureString);
}

/**
 * Generate a JWT token for Falcon model authentication
 * Uses the same format as the backend: team_id and token_id
 */
export async function generateFalconJWT(): Promise<string> {
  // Use the same secret and payload format as the backend
  const JWT_SECRET = "test-secret-456"; // Hardcoded to match backend
  const payload = {
    team_id: "tenstorrent",
    token_id: "debug-test",
  };

  // Create JWT header
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  // Encode header and payload
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  // Create signature
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = await createSignature(data, JWT_SECRET);

  // Return complete JWT
  return `${data}.${signature}`;
}
