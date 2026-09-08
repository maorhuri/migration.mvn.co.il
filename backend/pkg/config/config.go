// Package config handles application configuration
package config

import (
	"os"
	"strconv"
)

// Config holds application configuration
type Config struct {
	// Server
	Port        int
	Environment string

	// Database
	DBHost     string
	DBPort     int
	DBUser     string
	DBPassword string
	DBName     string
	DBSSLMode  string

	// Security
	MasterKey string

	// Logging
	LogLevel  string
	LogPretty bool

	// Paths
	WorkDir string
}

// Load loads configuration from environment variables
func Load() (*Config, error) {
	cfg := &Config{
		// Server defaults
		Port:        getEnvInt("PORT", 8080),
		Environment: getEnv("ENVIRONMENT", "development"),

		// Database defaults
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnvInt("DB_PORT", 5432),
		DBUser:     getEnv("DB_USER", "migration"),
		DBPassword: getEnv("DB_PASSWORD", "migration"),
		DBName:     getEnv("DB_NAME", "migration"),
		DBSSLMode:  getEnv("DB_SSL_MODE", "disable"),

		// Security
		MasterKey: getEnv("MASTER_KEY", "change-me-in-production-please"),

		// Logging
		LogLevel:  getEnv("LOG_LEVEL", "info"),
		LogPretty: getEnvBool("LOG_PRETTY", true),

		// Paths
		WorkDir: getEnv("WORK_DIR", "/var/lib/migration-tool/work"),
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}
