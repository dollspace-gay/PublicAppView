/**
 * Encryption Service
 * 
 * Provides secure encryption/decryption for sensitive data like OAuth tokens
 * Uses AES-256-GCM for authenticated encryption
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, CipherGCM, DecipherGCM } from 'crypto';

class EncryptionService {
  private algorithm = 'aes-256-gcm';
  private keyLength = 32; // 256 bits
  private ivLength = 16; // 128 bits
  private authTagLength = 16; // 128 bits
  private saltLength = 32;

  /**
   * Derives a 32-byte encryption key from the SESSION_SECRET
   */
  private deriveKey(secret: string, salt: Buffer): Buffer {
    return scryptSync(secret, salt, this.keyLength);
  }

  /**
   * Encrypts a string value
   * Returns: salt:iv:authTag:encryptedData (all hex encoded)
   */
  encrypt(plaintext: string): string {
    if (!process.env.SESSION_SECRET) {
      throw new Error('SESSION_SECRET not set - cannot encrypt data');
    }

    // Generate random salt and IV for this encryption
    const salt = randomBytes(this.saltLength);
    const iv = randomBytes(this.ivLength);
    
    // Derive encryption key from SESSION_SECRET and salt
    const key = this.deriveKey(process.env.SESSION_SECRET, salt);
    
    // Create cipher and encrypt
    const cipher = createCipheriv(this.algorithm, key, iv) as CipherGCM;
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get authentication tag
    const authTag = cipher.getAuthTag();
    
    // Return: salt:iv:authTag:encryptedData (all hex encoded)
    return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypts an encrypted string
   * Expects format: salt:iv:authTag:encryptedData (all hex encoded)
   */
  decrypt(encryptedData: string): string {
    if (!process.env.SESSION_SECRET) {
      throw new Error('SESSION_SECRET not set - cannot decrypt data');
    }

    try {
      // Parse the encrypted data
      const parts = encryptedData.split(':');
      if (parts.length !== 4) {
        throw new Error('Invalid encrypted data format');
      }

      const [saltHex, ivHex, authTagHex, encrypted] = parts;
      
      // Convert hex strings back to buffers
      const salt = Buffer.from(saltHex, 'hex');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      // Derive the same encryption key
      const key = this.deriveKey(process.env.SESSION_SECRET, salt);
      
      // Create decipher and decrypt
      const decipher = createDecipheriv(this.algorithm, key, iv) as DecipherGCM;
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('[ENCRYPTION] Decryption failed:', error instanceof Error ? error.message : 'Unknown error');
      throw new Error('Failed to decrypt data - may be corrupted or tampered with');
    }
  }

  /**
   * Checks if a string appears to be encrypted data
   */
  isEncrypted(data: string): boolean {
    // Encrypted data format: salt:iv:authTag:encryptedData
    const parts = data.split(':');
    return parts.length === 4 && parts.every(part => /^[0-9a-f]+$/i.test(part));
  }
}

export const encryptionService = new EncryptionService();
