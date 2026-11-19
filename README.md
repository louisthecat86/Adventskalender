# 🎄 Einundzwanzig Adventskalender

24 Türchen rund um Bitcoin, live über **Nostr**. Ein Community-Adventskalender für den [Einundzwanzig Podcast](https://einundzwanzig.space/).

**Kalender:** https://louisthecat86.github.io/Adventskalender/
**Host-Bereich:** https://louisthecat86.github.io/Adventskalender/admin.html

---

## So funktioniert's

- **Jedes Türchen ist ein Nostr-Post** des Hosts (`kind 1`, Hashtag `#einundzwanzigadvent`). Er erscheint im Kalender *und* in jeder Nostr-App.
- **Echte Datumssperre:** Der Inhalt existiert erst, wenn der Host ihn am jeweiligen Tag veröffentlicht. Im Repo liegt kein einziger Türchen-Inhalt.
- **Nur für Nostr-Nutzer:** Öffnen geht nur nach Login per Browser-Erweiterung (NIP-07: Alby, nos2x …), Signer-App (NIP-46: Amber, nsec.app …) oder Bunker-Adresse.
  Das ist eine Sperre in der Oberfläche. Die Posts selbst sind öffentlich auf Nostr, wie alles auf Nostr.
- **Nur der Host zählt:** Der Kalender zeigt ausschließlich signaturgeprüfte Events des in `config.js` eingetragenen npubs.
- **Kein Server, keine Datenbank:** reine statische Seite auf GitHub Pages. Alle Daten liegen auf den Relays.

## Für den Host

> 📖 Die ausführliche, einfache **[Anleitung für den Host](https://claude.ai/artifact/8e5oJ5B9yaoUiGRzHv8dDR)** erklärt Voraussetzungen, Preise, den Tagesablauf und was bei Problemen zu tun ist. Im Host-Bereich zeigt außerdem ein Hinweis „Nächster Schritt“ immer an, was beim ausgewählten Türchen als Nächstes zu tun ist.

### Vorbereiten (ab sofort)

1. `admin.html` öffnen und **als Host anmelden**. Die Erweiterung bzw. Signer-App muss **NIP-44** können (aktuelles Alby, nos2x, Amber, nsec.app).
2. Türchen auswählen, Titel, Art, Text und optional ein Bild eintragen.
3. **Entwurf speichern.** Der Entwurf wird mit NIP-44 *an dich selbst verschlüsselt* als `kind 30078` auf den Relays gespeichert. Niemand außer dir kann ihn lesen, und du kannst von jedem Gerät weiterarbeiten.

Formatierung im Text: `# Überschrift`, `- Liste`, `**fett**`, `_kursiv_`. Links, Bild-, Video- und Audio-URLs werden im Kalender eingebettet, `nostr:npub…` wird verlinkt.
Hinweis: Die meisten Nostr-Apps zeigen die Formatierung als reinen Text.

### Jeden Tag im Dezember

Host-Bereich öffnen → das Türchen des Tages ist schon ausgewählt → **Veröffentlichen**.
Vor dem jeweiligen Tag ist der Knopf gesperrt. Eine **Korrektur** veröffentlicht eine neue Fassung und löscht die alte (NIP-09).

### Verlosung

Art „🎁 Verlosung“ wählen, Preis, Teilnahme-Art (Reaktion / Antwort / Zap) und Teilnahmeschluss festlegen.
Nach dem Veröffentlichen erscheint im Host-Bereich das Feld **„Verlosung durchführen“**:

1. **Teilnehmer prüfen:** Gezählt werden Reaktionen (außer „-“), Antworten und Zaps (Absender aus der signierten Zap-Anfrage, NIP-57), jeweils bis zum Teilnahmeschluss. Jeder Npub zählt einmal, der Host ist ausgeschlossen.
   **Spam-Filter:** „nur Npubs mit Profil“ (Standard an) und „nur aus deinem Netzwerk“ (du folgst ihnen oder jemand, dem du folgst). Einzelne Npubs lassen sich per Haken auf- oder abwählen.
2. **Teilnahme schließen:** Die Liste wird als öffentliche Antwort festgeschrieben (alle Pubkeys + SHA-256-Prüfsumme). Gleichzeitig wird die **Blockhöhe = aktuelle Höhe + 2** festgelegt. Diesen Block gibt es da noch nicht.
3. **Gewinner ziehen**, sobald der Block gefunden ist (meist 10 bis 30 Minuten):
   ```
   Gewinner-Index = Blockhash (als Zahl)  mod  Anzahl Teilnehmer
   Teilnehmer = Pubkeys (hex), aufsteigend sortiert
   ```
   Das Ergebnis wird als Antwort veröffentlicht und erwähnt den Gewinner (er wird benachrichtigt).

Im Kalender kann **jeder** mit „Ziehung nachprüfen“ die Rechnung selbst nachvollziehen (Blockhash von mempool.space).

## Konfiguration

Alles Einstellbare steht in [`config.js`](config.js):

| Feld | Bedeutung |
|---|---|
| `hostNpub` | npub des Hosts, nur dessen Türchen werden angezeigt |
| `jahr`, `zeitzone`, `oeffnungsStunde` | wann welches Türchen aufgeht |
| `hashtag`, `kalenderId` | Kennzeichnung der Türchen-Posts. **Für jedes Jahr eine neue `kalenderId`!** |
| `relays` | Relays zum Lesen und Schreiben |
| `signerRelays` | Relays für die Verbindung mit Signer-Apps |
| `seitenUrl` | öffentliche Adresse (steht in jedem Post) |
| `mempoolApi` | Quelle der Blockhashes |
| `spamFilter` | Voreinstellung der Spam-Filter |
| `vorschauErlaubt` | `?vorschau=2026-12-10` an die URL hängen, um einen Tag zu simulieren |

**Vorschau-Modus:** `…/?vorschau=2026-12-10` zeigt den Kalender wie am 10. Dezember. Im Host-Bereich lässt sich damit auch früher veröffentlichen, mit deutlicher Warnung, denn der Post ist dann **sofort öffentlich**.

## Event-Format

Türchen (`kind 1`, vom Host):

```
content: 🎄 Türchen 7: <Titel>\n\n<Text>\n\n———\n<Bild-URL>\n🎁 Verlosung …\n👉 Zum Kalender: <URL>\n#einundzwanzigadvent
tags:
  ["t", "einundzwanzigadvent"]
  ["calendar", "einundzwanzig-advent-2026"]
  ["door", "7"]
  ["title", "…"]
  ["door-type", "text|artikel|podcast|video|gutschein|verlosung"]
  ["image", "https://…"]                         (optional)
  ["raffle", "reaction,reply,zap", "<ende unix>", "<Preis>"]   (bei Verlosung)
```

Verlosung (Antworten des Hosts auf das Türchen):
- Festschreibung: `["raffle-freeze", "<blockhöhe>"]`, `["participants-hash", "<sha256>"]`, `["participant", "<pubkey>"]…`
- Ergebnis: `["raffle-winner", "<pubkey>", "<blockhöhe>", "<blockhash>", "<index>"]`, `["p", "<gewinner>"]`

## Lokal entwickeln

Keine Build-Schritte nötig, einfach einen statischen Server starten:

```bash
python3 -m http.server 8080
# → http://localhost:8080/?vorschau=2026-12-05
```

Die Nostr-Bibliothek ([nostr-tools](https://github.com/nbd-wtf/nostr-tools)) und der QR-Code-Generator liegen gebündelt in `vendor/nostr.bundle.js`. Neu bauen:

```bash
cd tools && npm install && npm run build
```

## Struktur

```
index.html          Kalender
admin.html          Host-Bereich
config.js           Einstellungen
js/app.js           Kalender-Oberfläche
js/admin.js         Host-Bereich (Entwürfe, Veröffentlichen, Verlosung)
js/nostr.js         Relays, Login, Lesen/Schreiben, Event-Format
js/verlosung.js     Teilnehmer, Spam-Filter, Festschreibung, Ziehung, Prüfung
js/verlosung-ui.js  Anzeige Gewinner + Prüfung
js/login.js         Login-Dialog (NIP-07 / NIP-46)
js/zeit.js          Datumslogik (Europe/Berlin)
js/inhalt.js        sichere Darstellung der Inhalte
js/ui.js            Toast, Schnee
css/                Styles
vendor/             gebündeltes nostr-tools + QR-Code
tools/              Build für vendor/
```

## Credits

- Logo, Farben und Schrift (Inconsolata, SIL Open Font License) aus dem Medienbereich von [einundzwanzig.space](https://einundzwanzig.space/).
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) (Unlicense), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
- Blockdaten: [mempool.space](https://mempool.space/).
