// Package crypto provides encryption utilities for secure storage
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"

	"golang.org/x/crypto/pbkdf2"
)

const (
	// SaltSize is the size of the salt in bytes
	SaltSize = 32
	// KeySize is the size of the AES key in bytes (256 bits)
	KeySize = 32
	// NonceSize is the size of the GCM nonce
	NonceSize = 12
	// Iterations is the number of PBKDF2 iterations
	Iterations = 100000
)

// Encryptor handles encryption and decryption operations
type Encryptor struct {
	masterKey []byte
}

// NewEncryptor creates a new encryptor with the given master key
func NewEncryptor(masterKey string) *Encryptor {
	// Derive a proper key from the master key using SHA-256
	hash := sha256.Sum256([]byte(masterKey))
	return &Encryptor{
		masterKey: hash[:],
	}
}

// Encrypt encrypts plaintext using AES-256-GCM
func (e *Encryptor) Encrypt(plaintext []byte) (string, error) {
	// Generate a random salt
	salt := make([]byte, SaltSize)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", fmt.Errorf("failed to generate salt: %w", err)
	}

	// Derive key using PBKDF2
	key := pbkdf2.Key(e.masterKey, salt, Iterations, KeySize, sha256.New)

	// Create cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	// Create GCM
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	// Generate nonce
	nonce := make([]byte, NonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("failed to generate nonce: %w", err)
	}

	// Encrypt
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	// Combine salt + nonce + ciphertext
	result := make([]byte, SaltSize+NonceSize+len(ciphertext))
	copy(result[:SaltSize], salt)
	copy(result[SaltSize:SaltSize+NonceSize], nonce)
	copy(result[SaltSize+NonceSize:], ciphertext)

	return base64.StdEncoding.EncodeToString(result), nil
}

// Decrypt decrypts ciphertext encrypted with Encrypt
func (e *Encryptor) Decrypt(encrypted string) ([]byte, error) {
	// Decode base64
	data, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return nil, fmt.Errorf("failed to decode base64: %w", err)
	}

	if len(data) < SaltSize+NonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	// Extract salt, nonce, and ciphertext
	salt := data[:SaltSize]
	nonce := data[SaltSize : SaltSize+NonceSize]
	ciphertext := data[SaltSize+NonceSize:]

	// Derive key using PBKDF2
	key := pbkdf2.Key(e.masterKey, salt, Iterations, KeySize, sha256.New)

	// Create cipher
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}

	// Create GCM
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	// Decrypt
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt: %w", err)
	}

	return plaintext, nil
}

// EncryptString encrypts a string
func (e *Encryptor) EncryptString(plaintext string) (string, error) {
	return e.Encrypt([]byte(plaintext))
}

// DecryptString decrypts to a string
func (e *Encryptor) DecryptString(encrypted string) (string, error) {
	plaintext, err := e.Decrypt(encrypted)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// GenerateRandomKey generates a random encryption key
func GenerateRandomKey(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := io.ReadFull(rand.Reader, bytes); err != nil {
		return "", fmt.Errorf("failed to generate random key: %w", err)
	}
	return base64.StdEncoding.EncodeToString(bytes), nil
}

// HashPassword creates a hash of a password (for storing)
func HashPassword(password string, salt []byte) []byte {
	return pbkdf2.Key([]byte(password), salt, Iterations, KeySize, sha256.New)
}

// GenerateSalt generates a random salt
func GenerateSalt() ([]byte, error) {
	salt := make([]byte, SaltSize)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, fmt.Errorf("failed to generate salt: %w", err)
	}
	return salt, nil
}
