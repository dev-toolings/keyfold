// Package smtpmail sends plain text emails through an authenticated SMTP
// server. The connection is always encrypted: implicit TLS on port 465,
// STARTTLS on any other port.
package smtpmail

import (
	"crypto/tls"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"
)

const timeout = 30 * time.Second

// SMTP holds the server address (host:port), the login and the sender address.
type SMTP struct {
	Addr     string
	Username string
	Password string
	From     string
}

// Send delivers one UTF-8 plain text email to a single recipient.
func (m SMTP) Send(to, subject, body string) error {
	host, port, err := net.SplitHostPort(m.Addr)
	if err != nil {
		return err
	}
	dialer := &net.Dialer{Timeout: timeout}
	var conn net.Conn
	if port == "465" {
		conn, err = tls.DialWithDialer(dialer, "tcp", m.Addr, &tls.Config{ServerName: host})
	} else {
		conn, err = dialer.Dial("tcp", m.Addr)
	}
	if err != nil {
		return err
	}
	conn.SetDeadline(time.Now().Add(timeout))
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if port != "465" {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return fmt.Errorf("smtp %s does not offer STARTTLS", m.Addr)
		}
		if err := c.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return err
		}
	}
	if m.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", m.Username, m.Password, host)); err != nil {
			return err
		}
	}
	if err := c.Mail(m.From); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	wc, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := wc.Write(message(m.From, to, subject, body, time.Now())); err != nil {
		wc.Close()
		return err
	}
	if err := wc.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func message(from, to, subject, body string, now time.Time) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", to)
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", subject))
	fmt.Fprintf(&b, "Date: %s\r\n", now.Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(body)
	return []byte(b.String())
}
