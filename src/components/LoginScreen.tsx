"use client";

import { useState, FormEvent } from "react";

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await fetch("/api/auth/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput,
          password: passwordInput
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Aanmelden mislukt");
        return;
      }
      onLogin();
    } catch (err: any) {
      setAuthError("Netwerkfout tijdens het inloggen");
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '32px' }}>
      <div className="logo-container">
        <img src="/logo.png" alt="Ark Church Logo" />
        <h1 className="gradient-text">Ark Church Operations Center</h1>
      </div>
      <form onSubmit={handleLogin} className="glass-card" style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px', width: '450px' }}>
        <h2 style={{ textAlign: 'center', fontSize: '1.5rem', marginBottom: '10px' }}>Aanmelden</h2>

        <div className="input-group">
          <label className="input-label">Gebruikersnaam</label>
          <input
            type="text"
            className="input-field"
            required
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            placeholder="Gebruikersnaam"
          />
        </div>

        <div className="input-group">
          <label className="input-label">Wachtwoord</label>
          <input
            type="password"
            className="input-field"
            required
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {authError && (
          <p style={{ color: '#f87171', fontSize: '0.85rem', textAlign: 'center' }}>
            {authError}
          </p>
        )}

        <button
          type="submit"
          className="btn-primary"
          style={{ width: '100%', marginTop: '10px' }}
        >
          Aanmelden
        </button>
      </form>
    </div>
  );
}
