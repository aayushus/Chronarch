import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import logging

logger = logging.getLogger(__name__)

def is_smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST"))

def send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    smtp_host = os.getenv("SMTP_HOST")
    if not smtp_host:
        logger.info(f"SMTP_HOST not set — skipping email to {to_email}. Subject: {subject}")
        return False

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASSWORD", "")
    from_email = os.getenv("SMTP_FROM_EMAIL", smtp_user or "noreply@chronarch.internal")
    use_tls = os.getenv("SMTP_TLS", "true").lower() in ("true", "1", "yes")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email

    msg.attach(MIMEText(body_text, "plain"))
    if body_html:
        msg.attach(MIMEText(body_html, "html"))

    try:
        if use_tls:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
            server.starttls()
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
        
        if smtp_user and smtp_pass:
            server.login(smtp_user, smtp_pass)
        
        server.sendmail(from_email, [to_email], msg.as_string())
        server.quit()
        logger.info(f"Email sent successfully to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False

def send_invite_email(to_email: str, display_name: str, invite_link: str) -> bool:
    subject = "You've been invited to Chronarch Executive Scheduling"
    body_text = f"Hello {display_name},\n\nYou have been invited as an Executive Assistant on Chronarch.\n\nAccept your invitation and sign in here:\n{invite_link}\n\nBest regards,\nChronarch System"
    body_html = f"""
    <div style="font-family: sans-serif; padding: 20px;">
      <h2>Welcome to Chronarch</h2>
      <p>Hello {display_name},</p>
      <p>You have been invited as an Executive Assistant to manage calendar scheduling.</p>
      <p><a href="{invite_link}" style="background: #0070f3; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">Accept Invitation & Sign In</a></p>
      <p style="font-size: 12px; color: #666;">Or copy link: {invite_link}</p>
    </div>
    """
    return send_email(to_email, subject, body_text, body_html)

def send_password_reset_email(to_email: str, reset_link: str) -> bool:
    subject = "Chronarch Password Reset Request"
    body_text = f"Hello,\n\nA password reset was requested for your account.\n\nReset your password using the link below (valid for 1 hour):\n{reset_link}\n\nIf you did not request this, please ignore this message."
    body_html = f"""
    <div style="font-family: sans-serif; padding: 20px;">
      <h2>Password Reset Request</h2>
      <p>Click the link below to set a new password for your Chronarch account:</p>
      <p><a href="{reset_link}" style="background: #0070f3; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">Reset Password</a></p>
      <p style="font-size: 12px; color: #666;">Link valid for 1 hour: {reset_link}</p>
    </div>
    """
    return send_email(to_email, subject, body_text, body_html)
