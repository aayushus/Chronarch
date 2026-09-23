import os
import smtplib
from html import escape
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
    body_text = f"""Hello,

We received a request to reset your Chronarch password.

Reset your password here (this link expires in 1 hour):
{reset_link}

If you did not request this, you can safely ignore this email. Your password will not change.

-- Chronarch"""
    safe_reset_link = escape(reset_link, quote=True)
    body_html = f"""
    <!doctype html>
    <html lang="en">
      <body style="margin:0; padding:0; background:#f4f6f8; color:#17202a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8; padding:32px 16px;"><tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px; background:#ffffff; border:1px solid #e2e7ed; border-radius:14px; overflow:hidden;">
            <tr><td style="background:#171b23; padding:22px 28px;"><div style="color:#fff; font-size:20px; font-weight:700;">Chronarch</div><div style="color:#aeb7c4; font-size:12px; margin-top:4px;">Executive scheduling, made simple</div></td></tr>
            <tr><td style="padding:32px 28px 28px;">
              <div style="display:inline-block; background:#eaf2ff; color:#1769d2; border-radius:999px; padding:6px 10px; font-size:11px; font-weight:700; letter-spacing:.4px; text-transform:uppercase;">Account security</div>
              <h1 style="margin:16px 0 10px; color:#17202a; font-size:24px; line-height:1.25;">Reset your password</h1>
              <p style="margin:0 0 24px; color:#52606d; font-size:15px; line-height:1.6;">We received a request to set a new password for your Chronarch account.</p>
              <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:8px; background:#1677e8;"><a href="{safe_reset_link}" style="display:inline-block; padding:13px 20px; color:#fff; font-size:14px; font-weight:700; text-decoration:none;">Reset password</a></td></tr></table>
              <p style="margin:20px 0 0; color:#6b7785; font-size:12px; line-height:1.5;">This link expires in <strong>1 hour</strong> and can only be used once.</p>
              <div style="margin-top:24px; padding:14px; background:#f7f9fb; border:1px solid #e7ebef; border-radius:8px; color:#6b7785; font-size:11px; line-height:1.5; word-break:break-all;">If the button does not work, copy and paste this link into your browser:<br><a href="{safe_reset_link}" style="color:#1769d2;">{safe_reset_link}</a></div>
              <p style="margin:24px 0 0; color:#52606d; font-size:13px; line-height:1.6;">If you did not request this email, you can safely ignore it. Your password will not change.</p>
            </td></tr>
            <tr><td style="border-top:1px solid #edf0f2; padding:18px 28px; color:#8a95a3; font-size:11px; line-height:1.5;">This is an automated message from Chronarch. Please do not reply to this email.</td></tr>
          </table>
        </td></tr></table>
      </body>
    </html>
    """
    return send_email(to_email, subject, body_text, body_html)
