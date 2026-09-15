export const metadata = {
  title: "Privacyverklaring — Ark Church Operations Center",
};

export default function PrivacyPage() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 20px 80px' }}>
      <div style={{ maxWidth: '720px', width: '100%' }}>
        <div className="logo-container" style={{ marginBottom: '32px' }}>
          <img src="/logo.png" alt="Ark Church Logo" style={{ width: '56px', height: '56px' }} />
          <h1 className="gradient-text" style={{ fontSize: '1.7rem' }}>Ark Church Operations Center</h1>
        </div>

        <div className="glass-card" style={{ padding: '32px 36px' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '4px' }}>Privacyverklaring</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '28px' }}>Laatst bijgewerkt: 15 september 2026</p>

          <p style={{ marginBottom: '20px', lineHeight: 1.7 }}>
            Deze privacyverklaring beschrijft hoe <strong>Ark Church Operations Center</strong> omgaat met gegevens die worden verkregen
            via de koppeling met een Google-/YouTube-account. De applicatie is een intern hulpmiddel voor het plannen, uitzenden en
            bedienen van livestream-diensten van Ark Church.
          </p>

          <h2 style={{ color: 'var(--primary)', fontSize: '1.1rem', marginTop: '28px', marginBottom: '10px' }}>Wie is verantwoordelijk</h2>
          <p style={{ marginBottom: '20px', lineHeight: 1.7 }}>
            Jeffrey Go (Netwerkengineer.nl) is de ontwikkelaar en technisch beheerder van deze applicatie, in opdracht van Ark Church.
            Voor vragen over deze privacyverklaring of over de verwerking van gegevens kun je contact opnemen via{" "}
            <a href="mailto:jeffrey@netwerkengineer.nl" style={{ color: 'var(--primary)' }}>jeffrey@netwerkengineer.nl</a>.
          </p>

          <h2 style={{ color: 'var(--primary)', fontSize: '1.1rem', marginTop: '28px', marginBottom: '10px' }}>Welke gegevens worden gebruikt, en waarom</h2>
          <p style={{ marginBottom: '10px', lineHeight: 1.7 }}>Bij het koppelen van een Google-account aan de applicatie wordt toegang gevraagd tot:</p>
          <ul style={{ marginBottom: '20px', paddingLeft: '20px', lineHeight: 1.8 }}>
            <li><strong>Basisprofiel en e-mailadres</strong> — om de ingelogde gebruiker te identificeren binnen de applicatie.</li>
            <li><strong>YouTube-kanaalbeheer</strong> (scope <code>youtube</code>) — om livestream-uitzendingen op het YouTube-kanaal van Ark Church aan te maken, te plannen, te wijzigen en de status ervan (kijkers, statistieken, live-status) uit te lezen.</li>
            <li><strong>YouTube-uploads</strong> (scope <code>youtube.upload</code>) — om thumbnail-afbeeldingen voor geplande uitzendingen naar het kanaal te uploaden.</li>
          </ul>
          <p style={{ marginBottom: '20px', lineHeight: 1.7 }}>
            Deze toegang wordt uitsluitend gebruikt om het eigen YouTube-kanaal van Ark Church te beheren binnen deze applicatie.
            Er wordt geen toegang gevraagd tot, of gebruik gemaakt van, gegevens van andere YouTube-kanalen of -gebruikers.
          </p>

          <h2 style={{ color: 'var(--primary)', fontSize: '1.1rem', marginTop: '28px', marginBottom: '10px' }}>Hoe gegevens worden opgeslagen</h2>
          <p style={{ marginBottom: '20px', lineHeight: 1.7 }}>
            De verkregen toegangs- en vernieuwingstokens worden uitsluitend lokaal opgeslagen op de eigen serverinfrastructuur waarop
            de applicatie draait (beheerd door Ark Church / Netwerkengineer.nl), en worden niet gedeeld met derde partijen. De gegevens
            worden niet gebruikt voor advertentiedoeleinden en niet doorverkocht.
          </p>

          <h2 style={{ color: 'var(--primary)', fontSize: '1.1rem', marginTop: '28px', marginBottom: '10px' }}>Wie heeft toegang</h2>
          <p style={{ marginBottom: '20px', lineHeight: 1.7 }}>
            Toegang tot de applicatie zelf is beperkt tot geautoriseerde medewerkers en vrijwilligers van Ark Church, via een intern
            inlogsysteem met rolgebaseerde rechten. De Google-/YouTube-koppeling betreft één gedeeld, beheerd account (het YouTube-kanaal
            van Ark Church zelf), niet een persoonlijk account per gebruiker.
          </p>

          <h2 style={{ color: 'var(--primary)', fontSize: '1.1rem', marginTop: '28px', marginBottom: '10px' }}>Bewaartermijn en intrekken van toegang</h2>
          <p style={{ marginBottom: '20px', lineHeight: 1.7 }}>
            De gekoppelde toegang blijft actief totdat deze handmatig wordt ingetrokken door de beheerder van de applicatie, of totdat
            de gebruiker de toegang zelf intrekt via de eigen Google-accountinstellingen:{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener" style={{ color: 'var(--primary)' }}>
              myaccount.google.com/permissions
            </a>.
          </p>

          <h2 style={{ color: 'var(--primary)', fontSize: '1.1rem', marginTop: '28px', marginBottom: '10px' }}>Wijzigingen</h2>
          <p style={{ marginBottom: '0', lineHeight: 1.7 }}>
            Deze privacyverklaring kan van tijd tot tijd worden bijgewerkt. De datum bovenaan deze pagina geeft aan wanneer de laatste
            wijziging is doorgevoerd.
          </p>
        </div>
      </div>
    </div>
  );
}
