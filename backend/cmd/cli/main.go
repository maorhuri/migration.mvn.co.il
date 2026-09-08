package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
)

var (
	apiURL  string
	verbose bool
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "migration-cli",
		Short: "Migration Tool CLI",
		Long:  "CLI for managing server migrations between hosting panels",
	}

	rootCmd.PersistentFlags().StringVarP(&apiURL, "api-url", "u", "http://localhost:8080", "API server URL")
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "Verbose output")

	// Server commands
	serverCmd := &cobra.Command{
		Use:   "server",
		Short: "Manage servers",
	}

	serverCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List all servers",
		RunE:  listServers,
	})

	serverCmd.AddCommand(&cobra.Command{
		Use:   "add",
		Short: "Add a new server",
		RunE:  addServer,
	})

	serverCmd.AddCommand(&cobra.Command{
		Use:   "test [server-id]",
		Short: "Test server connection",
		Args:  cobra.ExactArgs(1),
		RunE:  testServer,
	})

	serverCmd.AddCommand(&cobra.Command{
		Use:   "accounts [server-id]",
		Short: "List accounts on a server",
		Args:  cobra.ExactArgs(1),
		RunE:  listAccounts,
	})

	serverCmd.AddCommand(&cobra.Command{
		Use:   "delete [server-id]",
		Short: "Delete a server",
		Args:  cobra.ExactArgs(1),
		RunE:  deleteServer,
	})

	// SSH Key commands
	keyCmd := &cobra.Command{
		Use:   "key",
		Short: "Manage SSH keys",
	}

	keyCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List all SSH keys",
		RunE:  listKeys,
	})

	keyCmd.AddCommand(&cobra.Command{
		Use:   "add",
		Short: "Add a new SSH key",
		RunE:  addKey,
	})

	keyCmd.AddCommand(&cobra.Command{
		Use:   "delete [key-id]",
		Short: "Delete an SSH key",
		Args:  cobra.ExactArgs(1),
		RunE:  deleteKey,
	})

	// Migration commands
	migrateCmd := &cobra.Command{
		Use:   "migrate",
		Short: "Manage migrations",
	}

	migrateCmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List all migrations",
		RunE:  listMigrations,
	})

	migrateCmd.AddCommand(&cobra.Command{
		Use:   "start",
		Short: "Start a new migration",
		RunE:  startMigration,
	})

	migrateCmd.AddCommand(&cobra.Command{
		Use:   "status [migration-id]",
		Short: "Get migration status",
		Args:  cobra.ExactArgs(1),
		RunE:  getMigrationStatus,
	})

	migrateCmd.AddCommand(&cobra.Command{
		Use:   "logs [migration-id]",
		Short: "Get migration logs",
		Args:  cobra.ExactArgs(1),
		RunE:  getMigrationLogs,
	})

	migrateCmd.AddCommand(&cobra.Command{
		Use:   "check",
		Short: "Check migration compatibility",
		RunE:  checkCompatibility,
	})

	rootCmd.AddCommand(serverCmd)
	rootCmd.AddCommand(keyCmd)
	rootCmd.AddCommand(migrateCmd)

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

// HTTP helpers

func apiRequest(method, endpoint string, body interface{}) ([]byte, error) {
	url := apiURL + "/api/v1" + endpoint

	var reqBody io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// Server commands

func listServers(cmd *cobra.Command, args []string) error {
	resp, err := apiRequest("GET", "/servers", nil)
	if err != nil {
		return err
	}

	var result struct {
		Items []struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			PanelType string `json:"panel_type"`
			Host      string `json:"host"`
			Port      int    `json:"port"`
		} `json:"items"`
	}

	if err := json.Unmarshal(resp, &result); err != nil {
		return err
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tTYPE\tHOST\tPORT")
	for _, s := range result.Items {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%d\n", s.ID, s.Name, s.PanelType, s.Host, s.Port)
	}
	w.Flush()

	return nil
}

func addServer(cmd *cobra.Command, args []string) error {
	var name, panelType, host, username, authMethod, password, apiKey, apiEndpoint, sshKeyID string
	var port int

	fmt.Print("Server name: ")
	fmt.Scanln(&name)

	fmt.Print("Panel type (directadmin/enhance/cpanel): ")
	fmt.Scanln(&panelType)

	fmt.Print("Host: ")
	fmt.Scanln(&host)

	fmt.Print("Port (default 22): ")
	fmt.Scanln(&port)
	if port == 0 {
		port = 22
	}

	fmt.Print("Username: ")
	fmt.Scanln(&username)

	fmt.Print("Auth method (password/ssh_key/api_key): ")
	fmt.Scanln(&authMethod)

	switch authMethod {
	case "password":
		fmt.Print("Password: ")
		fmt.Scanln(&password)
	case "ssh_key":
		fmt.Print("SSH Key ID: ")
		fmt.Scanln(&sshKeyID)
	case "api_key":
		fmt.Print("API Endpoint: ")
		fmt.Scanln(&apiEndpoint)
		fmt.Print("API Key: ")
		fmt.Scanln(&apiKey)
	}

	req := map[string]interface{}{
		"name":        name,
		"panel_type":  panelType,
		"host":        host,
		"port":        port,
		"username":    username,
		"auth_method": authMethod,
	}

	if password != "" {
		req["password"] = password
	}
	if sshKeyID != "" {
		req["ssh_key_id"] = sshKeyID
	}
	if apiEndpoint != "" {
		req["api_endpoint"] = apiEndpoint
	}
	if apiKey != "" {
		req["api_key"] = apiKey
	}

	resp, err := apiRequest("POST", "/servers", req)
	if err != nil {
		return err
	}

	var result struct {
		ID string `json:"id"`
	}
	json.Unmarshal(resp, &result)

	fmt.Printf("Server created with ID: %s\n", result.ID)
	return nil
}

func testServer(cmd *cobra.Command, args []string) error {
	serverID := args[0]

	resp, err := apiRequest("POST", "/servers/"+serverID+"/test", nil)
	if err != nil {
		return err
	}

	var result struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	json.Unmarshal(resp, &result)

	if result.Success {
		fmt.Println("Connection successful!")
	} else {
		fmt.Printf("Connection failed: %s\n", result.Message)
	}

	return nil
}

func listAccounts(cmd *cobra.Command, args []string) error {
	serverID := args[0]

	resp, err := apiRequest("GET", "/servers/"+serverID+"/accounts", nil)
	if err != nil {
		return err
	}

	var result struct {
		Items []struct {
			Username string `json:"username"`
			Domain   string `json:"domain"`
			Email    string `json:"email"`
		} `json:"items"`
	}

	if err := json.Unmarshal(resp, &result); err != nil {
		return err
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "USERNAME\tDOMAIN\tEMAIL")
	for _, a := range result.Items {
		fmt.Fprintf(w, "%s\t%s\t%s\n", a.Username, a.Domain, a.Email)
	}
	w.Flush()

	return nil
}

func deleteServer(cmd *cobra.Command, args []string) error {
	serverID := args[0]

	_, err := apiRequest("DELETE", "/servers/"+serverID, nil)
	if err != nil {
		return err
	}

	fmt.Println("Server deleted successfully")
	return nil
}

// SSH Key commands

func listKeys(cmd *cobra.Command, args []string) error {
	resp, err := apiRequest("GET", "/ssh-keys", nil)
	if err != nil {
		return err
	}

	var result struct {
		Items []struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			Fingerprint string `json:"fingerprint"`
		} `json:"items"`
	}

	if err := json.Unmarshal(resp, &result); err != nil {
		return err
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tFINGERPRINT")
	for _, k := range result.Items {
		fmt.Fprintf(w, "%s\t%s\t%s\n", k.ID, k.Name, k.Fingerprint)
	}
	w.Flush()

	return nil
}

func addKey(cmd *cobra.Command, args []string) error {
	var name, publicKeyPath, privateKeyPath, passphrase string

	fmt.Print("Key name: ")
	fmt.Scanln(&name)

	fmt.Print("Public key file path: ")
	fmt.Scanln(&publicKeyPath)

	fmt.Print("Private key file path: ")
	fmt.Scanln(&privateKeyPath)

	fmt.Print("Passphrase (optional): ")
	fmt.Scanln(&passphrase)

	publicKey, err := os.ReadFile(publicKeyPath)
	if err != nil {
		return fmt.Errorf("failed to read public key: %w", err)
	}

	privateKey, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return fmt.Errorf("failed to read private key: %w", err)
	}

	req := map[string]interface{}{
		"name":        name,
		"public_key":  string(publicKey),
		"private_key": string(privateKey),
	}

	if passphrase != "" {
		req["passphrase"] = passphrase
	}

	resp, err := apiRequest("POST", "/ssh-keys", req)
	if err != nil {
		return err
	}

	var result struct {
		ID string `json:"id"`
	}
	json.Unmarshal(resp, &result)

	fmt.Printf("SSH key created with ID: %s\n", result.ID)
	return nil
}

func deleteKey(cmd *cobra.Command, args []string) error {
	keyID := args[0]

	_, err := apiRequest("DELETE", "/ssh-keys/"+keyID, nil)
	if err != nil {
		return err
	}

	fmt.Println("SSH key deleted successfully")
	return nil
}

// Migration commands

func listMigrations(cmd *cobra.Command, args []string) error {
	resp, err := apiRequest("GET", "/migrations", nil)
	if err != nil {
		return err
	}

	var result struct {
		Items []struct {
			ID        string `json:"id"`
			Status    string `json:"status"`
			StartedAt string `json:"started_at"`
			Error     string `json:"error,omitempty"`
		} `json:"items"`
	}

	if err := json.Unmarshal(resp, &result); err != nil {
		return err
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tSTATUS\tSTARTED\tERROR")
	for _, m := range result.Items {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", m.ID, m.Status, m.StartedAt, m.Error)
	}
	w.Flush()

	return nil
}

func startMigration(cmd *cobra.Command, args []string) error {
	var sourceID, targetID, username, password string

	fmt.Print("Source server ID: ")
	fmt.Scanln(&sourceID)

	fmt.Print("Target server ID: ")
	fmt.Scanln(&targetID)

	fmt.Print("Account username to migrate: ")
	fmt.Scanln(&username)

	fmt.Print("New password for target account (optional): ")
	fmt.Scanln(&password)

	req := map[string]interface{}{
		"source_server_id": sourceID,
		"target_server_id": targetID,
		"username":         username,
	}

	if password != "" {
		req["new_password"] = password
	}

	resp, err := apiRequest("POST", "/migrations", req)
	if err != nil {
		return err
	}

	var result struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	json.Unmarshal(resp, &result)

	fmt.Printf("Migration started with ID: %s (status: %s)\n", result.ID, result.Status)
	fmt.Println("Use 'migration-cli migrate status " + result.ID + "' to check progress")
	return nil
}

func getMigrationStatus(cmd *cobra.Command, args []string) error {
	migrationID := args[0]

	resp, err := apiRequest("GET", "/migrations/"+migrationID, nil)
	if err != nil {
		return err
	}

	var result struct {
		ID       string `json:"id"`
		Status   string `json:"status"`
		Progress struct {
			CurrentStep      string `json:"current_step"`
			TotalSteps       int    `json:"total_steps"`
			CompletedSteps   int    `json:"completed_steps"`
			BytesTransferred int64  `json:"bytes_transferred"`
		} `json:"progress"`
		Error string `json:"error,omitempty"`
	}

	if err := json.Unmarshal(resp, &result); err != nil {
		return err
	}

	fmt.Printf("Migration ID: %s\n", result.ID)
	fmt.Printf("Status: %s\n", result.Status)
	if result.Progress.CurrentStep != "" {
		fmt.Printf("Current Step: %s\n", result.Progress.CurrentStep)
		fmt.Printf("Progress: %d/%d steps\n", result.Progress.CompletedSteps, result.Progress.TotalSteps)
		if result.Progress.BytesTransferred > 0 {
			fmt.Printf("Bytes Transferred: %d\n", result.Progress.BytesTransferred)
		}
	}
	if result.Error != "" {
		fmt.Printf("Error: %s\n", result.Error)
	}

	return nil
}

func getMigrationLogs(cmd *cobra.Command, args []string) error {
	migrationID := args[0]

	resp, err := apiRequest("GET", "/migrations/"+migrationID+"/logs", nil)
	if err != nil {
		return err
	}

	var result struct {
		Items []struct {
			Level     string `json:"level"`
			Message   string `json:"message"`
			CreatedAt string `json:"created_at"`
		} `json:"items"`
	}

	if err := json.Unmarshal(resp, &result); err != nil {
		return err
	}

	for _, log := range result.Items {
		fmt.Printf("[%s] %s: %s\n", log.CreatedAt, log.Level, log.Message)
	}

	return nil
}

func checkCompatibility(cmd *cobra.Command, args []string) error {
	var sourceID, targetID, username string

	fmt.Print("Source server ID: ")
	fmt.Scanln(&sourceID)

	fmt.Print("Target server ID: ")
	fmt.Scanln(&targetID)

	fmt.Print("Account username: ")
	fmt.Scanln(&username)

	req := map[string]interface{}{
		"source_server_id": sourceID,
		"target_server_id": targetID,
		"username":         username,
	}

	resp, err := apiRequest("POST", "/migrations/check-compatibility", req)
	if err != nil {
		return err
	}

	var result struct {
		Compatible bool     `json:"compatible"`
		Warnings   []string `json:"warnings"`
		Errors     []string `json:"errors"`
	}

	if err := json.Unmarshal(resp, &result); err != nil {
		return err
	}

	if result.Compatible {
		fmt.Println("Migration is compatible!")
	} else {
		fmt.Println("Migration is NOT compatible!")
	}

	if len(result.Warnings) > 0 {
		fmt.Println("\nWarnings:")
		for _, w := range result.Warnings {
			fmt.Printf("  - %s\n", w)
		}
	}

	if len(result.Errors) > 0 {
		fmt.Println("\nErrors:")
		for _, e := range result.Errors {
			fmt.Printf("  - %s\n", e)
		}
	}

	return nil
}
