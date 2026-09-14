"use client";

import { useState, useEffect, FormEvent } from "react";
import { signIn } from "next-auth/react";

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [sso, setSso] = useState<{ enabled: boolean; providerName: string } | null>(null);
  const [showLocalLogin, setShowLocalLogin] = useState(false);

  // Public, unauthenticated endpoint - this screen renders before anyone
  // is logged in, so it can't use the regular (auth-gated) settings route.
  useEffect(() => {
    fetch("/api/auth/sso-status")
      .then(res => res.json())
      .then(data => setSso(data))
      .catch(() => {});
  }, []);

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
      <div className="glass-card" style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px', width: '450px' }}>
        <h2 style={{ textAlign: 'center', fontSize: '1.5rem', marginBottom: '10px' }}>Aanmelden</h2>

        {sso?.enabled && (
          <button
            type="button"
            onClick={() => signIn("sso")}
            className="btn-primary"
            style={{ width: '100%' }}
          >
            {sso.providerName}
          </button>
        )}

        {sso?.enabled && !showLocalLogin && (
          <button
            type="button"
            onClick={() => setShowLocalLogin(true)}
            style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.6, fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Lokaal account gebruiken (noodtoegang)
          </button>
        )}

        {(!sso?.enabled || showLocalLogin) && (
          <>
            {sso?.enabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', opacity: 0.5, fontSize: '0.8rem' }}>
                <div style={{ flex: 1, height: '1px', background: 'currentColor' }} />
                of
                <div style={{ flex: 1, height: '1px', background: 'currentColor' }} />
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {sso?.enabled && (
                <p style={{ fontSize: '0.8rem', opacity: 0.6, margin: 0 }}>
                  Dit is een lokale gebruikersnaam en wachtwoord, los van je {sso.providerName}-account — bedoeld als noodtoegang.
                </p>
              )}
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
          </>
        )}
      </div>
    </div>
  );
}
