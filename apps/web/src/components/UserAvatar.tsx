import React, { useState } from "react";
import md5 from "md5";

import { avatarInitials } from "./EventCard";

interface UserAvatarProps {
  email?: string | null;
  name?: string | null;
  size?: number;
  title?: string;
}

/** Gravatar-backed identity avatar with a deterministic initials fallback. */
export default function UserAvatar({ email, name, size = 32, title }: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  const label = name?.trim() || normalizedEmail.split("@")[0] || "?";
  const url = normalizedEmail
    ? `https://www.gravatar.com/avatar/${md5(normalizedEmail)}?s=${size * 2}&d=404`
    : null;

  return (
    <span
      title={title ?? email ?? undefined}
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--accent)",
        color: "#fff",
        fontSize: Math.max(11, Math.round(size * 0.4)),
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {url && !failed ? (
        <img src={url} alt="" width={size} height={size} onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : avatarInitials(label)}
    </span>
  );
}
