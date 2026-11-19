// ============================================================
//  Einundzwanzig Adventskalender – zentrale Konfiguration
//  Nur diese Datei muss für ein neues Jahr / einen neuen Host
//  angepasst werden.
// ============================================================

export const CONFIG = {
  titel: 'Einundzwanzig Adventskalender',
  untertitel: '24 Türchen. Bitcoin, und sonst nichts.',

  // Jahr des Kalenders und Zeitzone, in der die Türchen aufgehen
  jahr: 2026,
  zeitzone: 'Europe/Berlin',
  // Stunde (0–23), ab der das Türchen des Tages geöffnet werden darf
  oeffnungsStunde: 0,

  // Host: dieser npub befüllt und veröffentlicht die Türchen.
  // Nur Events dieses Schlüssels werden im Kalender angezeigt.
  hostNpub: 'npub17fqtu2mgf7zueq2kdusgzwr2lqwhgfl2scjsez77ddag2qx8vxaq3vnr8y',

  // Hashtag, unter dem die Türchen auf Nostr erscheinen (ohne #)
  hashtag: 'einundzwanzigadvent',
  // Eindeutige Kalender-ID (in jedem Türchen-Event als Tag hinterlegt)
  kalenderId: 'einundzwanzig-advent-2026',

  // Relays, von denen gelesen und auf die geschrieben wird
  relays: [
    'wss://nostr.einundzwanzig.space',
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
  ],

  // Relays für die Verbindung mit Signer-Apps (NIP-46 / nostrconnect)
  signerRelays: ['wss://relay.nsec.app', 'wss://relay.damus.io', 'wss://nos.lol'],

  // Vorschau per URL erlauben: ?vorschau=2026-12-10
  // Ändert nur die Anzeige. Inhalte gibt es trotzdem erst, wenn der
  // Host sie veröffentlicht hat.
  vorschauErlaubt: true,

  // Links
  // Öffentliche Adresse des Kalenders (steht in jedem Türchen-Post)
  seitenUrl: 'https://louisthecat86.github.io/Adventskalender/',
  podcastUrl: 'https://einundzwanzig.space/',
  // Link zur Host-Anleitung (wird im Host-Bereich angezeigt, leer = ausgeblendet)
  anleitungUrl: 'https://claude.ai/artifact/8e5oJ5B9yaoUiGRzHv8dDR',
  // Quelle für Bitcoin-Blockhashes (Verlosung)
  mempoolApi: 'https://mempool.space/api',

  // Spam-Filter für Verlosungen (Voreinstellung, im Host-Bereich je Verlosung umschaltbar)
  spamFilter: {
    nurMitProfil: true, // Npubs ohne Profil (Name/Bild) aussortieren
    nurNetzwerk: false, // nur Npubs, denen der Host folgt – oder denen jemand folgt, dem der Host folgt
  },
  nostrViewer: 'https://njump.me/',
}
