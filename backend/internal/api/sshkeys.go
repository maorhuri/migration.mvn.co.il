package api

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/migration-tool/backend/internal/storage"
	"golang.org/x/crypto/ssh"
)

// sshKeyView is an SSH key as returned by the API: the public half plus the
// one-liner that authorizes it on a target server.
type sshKeyView struct {
	*storage.SSHKey
	InstallCommand string `json:"install_command"`
}

func keyView(k *storage.SSHKey) sshKeyView {
	return sshKeyView{SSHKey: k, InstallCommand: installCommand(k.PublicKey)}
}

// installCommand returns the command to paste on a server (as root) to authorize the key
func installCommand(pub string) string {
	pub = strings.TrimSpace(pub)
	return fmt.Sprintf("mkdir -p ~/.ssh && chmod 700 ~/.ssh && (grep -qF '%s' ~/.ssh/authorized_keys 2>/dev/null || echo '%s' >> ~/.ssh/authorized_keys) && chmod 600 ~/.ssh/authorized_keys && echo 'migration key installed'", pub, pub)
}

// inspectPrivateKey parses a private key and returns its authorized_keys line and fingerprint
func inspectPrivateKey(privateKey, passphrase string) (pubLine, fingerprint string, err error) {
	var signer ssh.Signer
	if passphrase != "" {
		signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(privateKey), []byte(passphrase))
	} else {
		signer, err = ssh.ParsePrivateKey([]byte(privateKey))
	}
	if err != nil {
		return "", "", err
	}
	pub := signer.PublicKey()
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub))), ssh.FingerprintSHA256(pub), nil
}

var keyNameSanitizer = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// generateSSHKey creates a new ed25519 key pair server-side; the private half never leaves the tool.
func (h *Handler) generateSSHKey(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate key: " + err.Error()})
		return
	}
	comment := "migration-tool-" + keyNameSanitizer.ReplaceAllString(strings.TrimSpace(req.Name), "-")
	block, err := ssh.MarshalPrivateKey(priv, comment)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encode key: " + err.Error()})
		return
	}
	privPEM := string(pem.EncodeToMemory(block))
	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	pubLine := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(sshPub))) + " " + comment

	key := &storage.SSHKey{
		Name:        req.Name,
		PublicKey:   pubLine,
		Fingerprint: storage.NewNullString(ssh.FingerprintSHA256(sshPub)),
	}
	if err := h.db.CreateSSHKey(c.Request.Context(), key, privPEM, ""); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, keyView(key))
}

// setDefaultSSHKey marks a key as the one used for cluster nodes (PUT) or clears it (DELETE)
func (h *Handler) setDefaultSSHKey(c *gin.Context) {
	id := c.Param("id")
	isDefault := c.Request.Method != http.MethodDelete
	if err := h.db.SetDefaultSSHKey(c.Request.Context(), id, isDefault); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	key, err := h.db.GetSSHKey(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "SSH key not found"})
		return
	}
	c.JSON(http.StatusOK, keyView(key))
}
