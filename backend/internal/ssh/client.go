// Package ssh provides SSH and SFTP connection management
package ssh

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/migration-tool/backend/internal/panels/common"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// execCommand is a variable to allow mocking in tests
var execCommand = exec.Command

// Client manages SSH connections
type Client struct {
	config     *common.ConnectionConfig
	sshClient  *ssh.Client
	sftpClient *sftp.Client
	mu         sync.Mutex
}

// NewClient creates a new SSH client
func NewClient() *Client {
	return &Client{}
}

// Connect establishes SSH connection
func (c *Client) Connect(ctx context.Context, config *common.ConnectionConfig, password string, privateKey []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	var authMethods []ssh.AuthMethod

	switch config.AuthMethod {
	case common.AuthMethodPassword:
		authMethods = append(authMethods, ssh.Password(password))
	case common.AuthMethodSSHKey:
		signer, err := ssh.ParsePrivateKey(privateKey)
		if err != nil {
			// Try with passphrase if provided
			signer, err = ssh.ParsePrivateKeyWithPassphrase(privateKey, []byte(password))
			if err != nil {
				return fmt.Errorf("failed to parse private key: %w", err)
			}
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	default:
		return fmt.Errorf("unsupported auth method: %s", config.AuthMethod)
	}

	port := config.Port
	if port == 0 {
		port = 22
	}

	sshConfig := &ssh.ClientConfig{
		User:            config.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: Implement proper host key verification
		Timeout:         30 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", config.Host, port)

	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		return fmt.Errorf("failed to connect to %s: %w", addr, err)
	}

	c.sshClient = client
	c.config = config
	// Store private key for rsync
	c.config.PrivateKey = privateKey

	return nil
}

// ConnectSFTP establishes SFTP connection (requires SSH connection first)
func (c *Client) ConnectSFTP() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.sshClient == nil {
		return fmt.Errorf("SSH connection not established")
	}

	sftpClient, err := sftp.NewClient(c.sshClient)
	if err != nil {
		return fmt.Errorf("failed to create SFTP client: %w", err)
	}

	c.sftpClient = sftpClient
	return nil
}

// Disconnect closes all connections
func (c *Client) Disconnect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	var errs []error

	if c.sftpClient != nil {
		if err := c.sftpClient.Close(); err != nil {
			errs = append(errs, err)
		}
		c.sftpClient = nil
	}

	if c.sshClient != nil {
		if err := c.sshClient.Close(); err != nil {
			errs = append(errs, err)
		}
		c.sshClient = nil
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors during disconnect: %v", errs)
	}
	return nil
}

// RunCommand executes a command over SSH
func (c *Client) RunCommand(ctx context.Context, command string) (string, error) {
	c.mu.Lock()
	if c.sshClient == nil {
		c.mu.Unlock()
		return "", fmt.Errorf("SSH connection not established")
	}
	client := c.sshClient
	c.mu.Unlock()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	if err != nil {
		return string(output), fmt.Errorf("command failed: %w, output: %s", err, string(output))
	}

	return string(output), nil
}

// RunCommandWithStdin executes a command with stdin input
func (c *Client) RunCommandWithStdin(ctx context.Context, command string, stdin io.Reader) (string, error) {
	c.mu.Lock()
	if c.sshClient == nil {
		c.mu.Unlock()
		return "", fmt.Errorf("SSH connection not established")
	}
	client := c.sshClient
	c.mu.Unlock()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}
	defer session.Close()

	session.Stdin = stdin
	output, err := session.CombinedOutput(command)
	if err != nil {
		return string(output), fmt.Errorf("command failed: %w, output: %s", err, string(output))
	}

	return string(output), nil
}

// Upload uploads a file via SFTP
func (c *Client) Upload(ctx context.Context, localPath, remotePath string) error {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	localFile, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("failed to open local file: %w", err)
	}
	defer localFile.Close()

	// Create remote directory if needed
	remoteDir := filepath.Dir(remotePath)
	if err := sftpClient.MkdirAll(remoteDir); err != nil {
		return fmt.Errorf("failed to create remote directory: %w", err)
	}

	remoteFile, err := sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create remote file: %w", err)
	}
	defer remoteFile.Close()

	_, err = io.Copy(remoteFile, localFile)
	if err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}

	return nil
}

// Download downloads a file via SFTP
func (c *Client) Download(ctx context.Context, remotePath, localPath string) error {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	remoteFile, err := sftpClient.Open(remotePath)
	if err != nil {
		return fmt.Errorf("failed to open remote file: %w", err)
	}
	defer remoteFile.Close()

	// Create local directory if needed
	localDir := filepath.Dir(localPath)
	if err := os.MkdirAll(localDir, 0755); err != nil {
		return fmt.Errorf("failed to create local directory: %w", err)
	}

	localFile, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("failed to create local file: %w", err)
	}
	defer localFile.Close()

	_, err = io.Copy(localFile, remoteFile)
	if err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}

	return nil
}

// UploadStream uploads from a reader
func (c *Client) UploadStream(ctx context.Context, reader io.Reader, remotePath string, size int64) error {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	// Create remote directory if needed
	remoteDir := filepath.Dir(remotePath)
	if err := sftpClient.MkdirAll(remoteDir); err != nil {
		return fmt.Errorf("failed to create remote directory: %w", err)
	}

	remoteFile, err := sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create remote file: %w", err)
	}
	defer remoteFile.Close()

	_, err = io.Copy(remoteFile, reader)
	if err != nil {
		return fmt.Errorf("failed to copy stream: %w", err)
	}

	return nil
}

// DownloadStream downloads to a writer
func (c *Client) DownloadStream(ctx context.Context, remotePath string, writer io.Writer) error {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	remoteFile, err := sftpClient.Open(remotePath)
	if err != nil {
		return fmt.Errorf("failed to open remote file: %w", err)
	}
	defer remoteFile.Close()

	_, err = io.Copy(writer, remoteFile)
	if err != nil {
		return fmt.Errorf("failed to copy stream: %w", err)
	}

	return nil
}

// List lists files in a directory
func (c *Client) List(ctx context.Context, path string) ([]common.FileInfo, error) {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	entries, err := sftpClient.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	var files []common.FileInfo
	for _, entry := range entries {
		files = append(files, common.FileInfo{
			Name:    entry.Name(),
			Path:    filepath.Join(path, entry.Name()),
			Size:    entry.Size(),
			Mode:    entry.Mode().String(),
			ModTime: entry.ModTime(),
			IsDir:   entry.IsDir(),
		})
	}

	return files, nil
}

// Mkdir creates a directory
func (c *Client) Mkdir(ctx context.Context, path string) error {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	return sftpClient.MkdirAll(path)
}

// Remove removes a file or directory
func (c *Client) Remove(ctx context.Context, path string) error {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	return sftpClient.Remove(path)
}

// Stat returns file info
func (c *Client) Stat(ctx context.Context, path string) (*common.FileInfo, error) {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	info, err := sftpClient.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	return &common.FileInfo{
		Name:    info.Name(),
		Path:    path,
		Size:    info.Size(),
		Mode:    info.Mode().String(),
		ModTime: info.ModTime(),
		IsDir:   info.IsDir(),
	}, nil
}

// DownloadDirectory downloads an entire directory recursively
func (c *Client) DownloadDirectory(ctx context.Context, remotePath, localPath string, progress chan<- int64) error {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	return c.downloadDirRecursive(ctx, sftpClient, remotePath, localPath, progress)
}

func (c *Client) downloadDirRecursive(ctx context.Context, sftpClient *sftp.Client, remotePath, localPath string, progress chan<- int64) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	entries, err := sftpClient.ReadDir(remotePath)
	if err != nil {
		return fmt.Errorf("failed to read directory %s: %w", remotePath, err)
	}

	if err := os.MkdirAll(localPath, 0755); err != nil {
		return fmt.Errorf("failed to create local directory: %w", err)
	}

	for _, entry := range entries {
		remoteFilePath := filepath.Join(remotePath, entry.Name())
		localFilePath := filepath.Join(localPath, entry.Name())

		if entry.IsDir() {
			if err := c.downloadDirRecursive(ctx, sftpClient, remoteFilePath, localFilePath, progress); err != nil {
				return err
			}
		} else {
			if err := c.downloadFile(sftpClient, remoteFilePath, localFilePath, progress); err != nil {
				return err
			}
		}
	}

	return nil
}

func (c *Client) downloadFile(sftpClient *sftp.Client, remotePath, localPath string, progress chan<- int64) error {
	remoteFile, err := sftpClient.Open(remotePath)
	if err != nil {
		return fmt.Errorf("failed to open remote file %s: %w", remotePath, err)
	}
	defer remoteFile.Close()

	localFile, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("failed to create local file %s: %w", localPath, err)
	}
	defer localFile.Close()

	written, err := io.Copy(localFile, remoteFile)
	if err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}

	if progress != nil {
		progress <- written
	}

	return nil
}

// UploadDirectory uploads an entire directory recursively
func (c *Client) UploadDirectory(ctx context.Context, localPath, remotePath string, progress chan<- int64) error {
	c.mu.Lock()
	if c.sftpClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SFTP connection not established")
	}
	sftpClient := c.sftpClient
	c.mu.Unlock()

	return c.uploadDirRecursive(ctx, sftpClient, localPath, remotePath, progress)
}

func (c *Client) uploadDirRecursive(ctx context.Context, sftpClient *sftp.Client, localPath, remotePath string, progress chan<- int64) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	entries, err := os.ReadDir(localPath)
	if err != nil {
		return fmt.Errorf("failed to read local directory %s: %w", localPath, err)
	}

	if err := sftpClient.MkdirAll(remotePath); err != nil {
		return fmt.Errorf("failed to create remote directory: %w", err)
	}

	for _, entry := range entries {
		localFilePath := filepath.Join(localPath, entry.Name())
		remoteFilePath := filepath.Join(remotePath, entry.Name())

		if entry.IsDir() {
			if err := c.uploadDirRecursive(ctx, sftpClient, localFilePath, remoteFilePath, progress); err != nil {
				return err
			}
		} else {
			if err := c.uploadFile(sftpClient, localFilePath, remoteFilePath, progress); err != nil {
				return err
			}
		}
	}

	return nil
}

func (c *Client) uploadFile(sftpClient *sftp.Client, localPath, remotePath string, progress chan<- int64) error {
	localFile, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("failed to open local file %s: %w", localPath, err)
	}
	defer localFile.Close()

	remoteFile, err := sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create remote file %s: %w", remotePath, err)
	}
	defer remoteFile.Close()

	written, err := io.Copy(remoteFile, localFile)
	if err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}

	if progress != nil {
		progress <- written
	}

	return nil
}

// GetSSHClient returns the underlying SSH client
func (c *Client) GetSSHClient() *ssh.Client {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sshClient
}

// GetSFTPClient returns the underlying SFTP client
func (c *Client) GetSFTPClient() *sftp.Client {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sftpClient
}

// FastDownloadDirectory downloads a directory using tar+ssh (much faster than SFTP)
// Falls back to SFTP if tar is not available
func (c *Client) FastDownloadDirectory(ctx context.Context, remotePath, localPath string, progress chan<- int64) error {
	c.mu.Lock()
	if c.sshClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SSH connection not established")
	}
	client := c.sshClient
	c.mu.Unlock()

	// Create local directory
	if err := os.MkdirAll(localPath, 0755); err != nil {
		return fmt.Errorf("failed to create local directory: %w", err)
	}

	// Try tar+ssh first (fastest method)
	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	defer session.Close()

	// Create tar archive on remote and stream to local
	// Using pigz for parallel compression if available, fallback to gzip
	tarCmd := fmt.Sprintf("cd %s && tar -cf - . 2>/dev/null | pigz -1 2>/dev/null || tar -czf - . 2>/dev/null", remotePath)

	stdout, err := session.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	if err := session.Start(tarCmd); err != nil {
		// Fallback to SFTP
		return c.DownloadDirectory(ctx, remotePath, localPath, progress)
	}

	// Extract locally using tar
	extractCmd := fmt.Sprintf("cd %s && tar -xzf - 2>/dev/null || tar -xf -", localPath)

	// Use exec to run local tar
	cmd := execCommand("sh", "-c", extractCmd)
	cmd.Stdin = stdout

	var totalBytes int64
	go func() {
		// Estimate progress based on time
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				totalBytes += 1024 * 1024 // Estimate 1MB per tick
				if progress != nil {
					progress <- 1024 * 1024
				}
			}
		}
	}()

	if err := cmd.Run(); err != nil {
		// Fallback to SFTP
		session.Close()
		return c.DownloadDirectory(ctx, remotePath, localPath, progress)
	}

	session.Wait()
	return nil
}

// FastUploadDirectory uploads a directory using tar+ssh (much faster than SFTP)
func (c *Client) FastUploadDirectory(ctx context.Context, localPath, remotePath string, progress chan<- int64) error {
	c.mu.Lock()
	if c.sshClient == nil {
		c.mu.Unlock()
		return fmt.Errorf("SSH connection not established")
	}
	client := c.sshClient
	c.mu.Unlock()

	// Create remote directory
	if _, err := c.RunCommand(ctx, fmt.Sprintf("mkdir -p %s", remotePath)); err != nil {
		return fmt.Errorf("failed to create remote directory: %w", err)
	}

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	defer session.Close()

	// Extract on remote side
	extractCmd := fmt.Sprintf("cd %s && tar -xzf - 2>/dev/null || tar -xf -", remotePath)

	stdin, err := session.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	if err := session.Start(extractCmd); err != nil {
		// Fallback to SFTP
		return c.UploadDirectory(ctx, localPath, remotePath, progress)
	}

	// Create tar locally and stream to remote
	tarCmd := fmt.Sprintf("cd %s && tar -cf - . | pigz -1 2>/dev/null || tar -czf - .", localPath)
	cmd := execCommand("sh", "-c", tarCmd)
	cmd.Stdout = stdin

	var totalBytes int64
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				totalBytes += 1024 * 1024
				if progress != nil {
					progress <- 1024 * 1024
				}
			}
		}
	}()

	if err := cmd.Run(); err != nil {
		stdin.Close()
		session.Close()
		// Fallback to SFTP
		return c.UploadDirectory(ctx, localPath, remotePath, progress)
	}

	stdin.Close()
	session.Wait()
	return nil
}

// RsyncDownload uses rsync for fastest transfer (if available)
func (c *Client) RsyncDownload(ctx context.Context, remotePath, localPath, host, user string, port int, privateKeyPath string) error {
	// Build rsync command with optimal settings
	rsyncArgs := []string{
		"-avz",               // archive, verbose, compress
		"--compress-level=1", // fast compression
		"--progress",         // show progress
		"-e", fmt.Sprintf("ssh -p %d -i %s -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null", port, privateKeyPath),
		fmt.Sprintf("%s@%s:%s/", user, host, remotePath),
		localPath + "/",
	}

	cmd := execCommand("rsync", rsyncArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("rsync failed: %w, output: %s", err, string(output))
	}

	return nil
}

// RsyncUpload uses rsync for fastest transfer (if available)
func (c *Client) RsyncUpload(ctx context.Context, localPath, remotePath, host, user string, port int, privateKeyPath string) error {
	rsyncArgs := []string{
		"-avz",
		"--compress-level=1",
		"--progress",
		"-e", fmt.Sprintf("ssh -p %d -i %s -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null", port, privateKeyPath),
		localPath + "/",
		fmt.Sprintf("%s@%s:%s/", user, host, remotePath),
	}

	cmd := execCommand("rsync", rsyncArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("rsync failed: %w, output: %s", err, string(output))
	}

	return nil
}

// RsyncDownloadWithKey uses rsync with the stored connection config
// Falls back to tar+ssh if rsync with key fails, or uses SFTP for password auth
func (c *Client) RsyncDownloadWithKey(ctx context.Context, remotePath, localPath string) error {
	c.mu.Lock()
	config := c.config
	c.mu.Unlock()

	if config == nil {
		return fmt.Errorf("no connection config available")
	}

	port := config.Port
	if port == 0 {
		port = 22
	}

	// If using SSH key, try rsync with key file
	if config.AuthMethod == common.AuthMethodSSHKey && len(config.PrivateKey) > 0 {
		// Write private key to temp file for rsync
		tmpKeyFile, err := os.CreateTemp("", "migration_key_*")
		if err != nil {
			return fmt.Errorf("failed to create temp key file: %w", err)
		}
		defer os.Remove(tmpKeyFile.Name())

		if _, err := tmpKeyFile.Write(config.PrivateKey); err != nil {
			tmpKeyFile.Close()
			return fmt.Errorf("failed to write key: %w", err)
		}
		tmpKeyFile.Close()

		if err := os.Chmod(tmpKeyFile.Name(), 0600); err != nil {
			return fmt.Errorf("failed to chmod key: %w", err)
		}

		// rsync with optimal settings for speed
		rsyncArgs := []string{
			"-avz",               // archive, verbose, compress
			"--compress-level=1", // fast compression
			"--whole-file",       // don't use delta algorithm (faster for new files)
			"--no-inc-recursive", // faster for large directories
			"-e", fmt.Sprintf("ssh -p %d -i %s -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o Compression=no", port, tmpKeyFile.Name()),
			fmt.Sprintf("%s@%s:%s/", config.Username, config.Host, remotePath),
			localPath + "/",
		}

		cmd := execCommand("rsync", rsyncArgs...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("rsync failed: %w, output: %s", err, string(output))
		}
		return nil
	}

	// For password auth, use tar+ssh through existing SSH connection (faster than SFTP)
	return c.FastDownloadDirectory(ctx, remotePath, localPath, nil)
}

// RsyncUploadWithKey uses rsync with the stored connection config
func (c *Client) RsyncUploadWithKey(ctx context.Context, localPath, remotePath string) error {
	c.mu.Lock()
	config := c.config
	c.mu.Unlock()

	if config == nil {
		return fmt.Errorf("no connection config available")
	}

	port := config.Port
	if port == 0 {
		port = 22
	}

	// If using SSH key, try rsync with key file
	if config.AuthMethod == common.AuthMethodSSHKey && len(config.PrivateKey) > 0 {
		// Write private key to temp file for rsync
		tmpKeyFile, err := os.CreateTemp("", "migration_key_*")
		if err != nil {
			return fmt.Errorf("failed to create temp key file: %w", err)
		}
		defer os.Remove(tmpKeyFile.Name())

		if _, err := tmpKeyFile.Write(config.PrivateKey); err != nil {
			tmpKeyFile.Close()
			return fmt.Errorf("failed to write key: %w", err)
		}
		tmpKeyFile.Close()

		if err := os.Chmod(tmpKeyFile.Name(), 0600); err != nil {
			return fmt.Errorf("failed to chmod key: %w", err)
		}

		rsyncArgs := []string{
			"-avz",
			"--compress-level=1",
			"--whole-file",
			"-e", fmt.Sprintf("ssh -p %d -i %s -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o Compression=no", port, tmpKeyFile.Name()),
			localPath + "/",
			fmt.Sprintf("%s@%s:%s/", config.Username, config.Host, remotePath),
		}

		cmd := execCommand("rsync", rsyncArgs...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("rsync failed: %w, output: %s", err, string(output))
		}
		return nil
	}

	// For password auth, use tar+ssh through existing SSH connection
	return c.FastUploadDirectory(ctx, localPath, remotePath, nil)
}
