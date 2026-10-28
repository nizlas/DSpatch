Planen bör omfatta **hela vägen från valt revisionspar till en begriplig genomgång och ett granskningsbeslut**. Läsbarheten är en del av funktionen, inte efterföljande polish.

### 1. Förbered genomgången

Från diffreviewen väljer användaren **Prepare code walks**. Agenten undersöker de valda revisionerna, diffen och relevant omgivande kod.

Agenten föreslår walks kring beteenden eller frågor, exempelvis ”Vad händer när användaren avbryter?”. Varje walk har:

- en kort beskrivning av vad användaren kommer att förstå;
- en motivering till varför den är relevant;
- steg med konkreta kodreferenser, även över filgränser;
- koppling till de ändrade rader den behandlar.

DSpatch validerar referenserna och visar ändringar som ingen walk omfattar. Tester, konfiguration, felhantering och borttagna beteenden ska också kunna behandlas. **En skapad walk innebär ingen granskning eller något godkännande.**

### 2. Gör varje steg lätt att förstå

Grundförklaringen ska beskriva **vad som händer, varför och vad som är viktigt i koden**. Den ska ge nödvändigt sammanhang innan detaljer introduceras.

Skrivregler:

- Använd konkret språk och ange vem som gör vad: användaren, DSpatch, providern eller en viss komponent.
- Förklara orsak och följd. Undvik formuleringar som ”en körning dyker upp” utan att förklara varför.
- Behåll relevanta klassnamn, metoder och etablerade begrepp som arv och subklass. Förklara dem vid behov utan att ersätta dem med vaga förenklingar.
- Använd korta stycken. Bullets passar alternativa fall; numrering passar en faktisk ordningsföljd.
- Betona sparsamt det centrala sambandet eller konsekvensen.
- Skilj kodens avsedda beteende, agentens slutsatser och faktiskt observerade testresultat åt.

Det ska inte finnas ett stelt ordantal eller en mall med många obligatoriska rubriker. Texten ska vara så kort som förståelsen tillåter.

### 3. Ge mer information där den behövs

Varje steg erbjuder diskreta åtgärder:

| Åtgärd | Beteende |
|---|---|
| **Berätta mer** | Utvecklar mekanismen, kodkopplingarna och relevanta detaljer. |
| **Förklara enklare** | Förklarar samma innehåll med mer bakgrund, tydligare orsakssamband eller ett konkret exempel. |
| **Förklara detta** | Förklarar en markerad mening eller ett begrepp i sitt sammanhang. |

Frågan får automatiskt med revisionsparet, aktuellt steg, relevant kod och eventuell markerad text.

Svaret visas som en lokal, hopfällbar fördjupning vid steget. Det går också att fortsätta diskutera i reviewchatten med samma kontext. Användaren ska inte behöva kopiera text eller återberätta vad den tittar på.

Fördjupning bevarar position och granskningsbeslut. **En begäran om enklare förklaring ändrar inte automatiskt hela reviewens nivå.** Granskningsdjup och pedagogisk nivå hålls separata.

### 4. Ge text och kod tillräckligt med plats

Förklaringsspalten får mer utrymme som standard och en dragbar avdelare. Användarens valda bredd sparas.

- Behåll en bekväm radlängd och tydlig luft mellan stycken.
- Visa walkens introduktion kortfattat, med utveckling på begäran.
- Undvik stora staplade textpaneler och upprepade förklaringar på walk-, steg- och kodplatsnivå.
- Behåll kodreferenser nära den förklaring de stöder.
- Låt kod och förklaring vara användbara även i mindre fönster.

Difföversikten och walkfönstret förblir separata, med gemensam granskningsstatus och självständig navigering.

### 5. Låt användaren granska eller delegera

Användaren kan granska själv, diskutera eller uttryckligen delegera en walk, fil eller ett radintervall till agenten.

Agenten redovisar:

- vad som faktiskt granskats;
- bedömning och underlag;
- upptäckta problem och kvarvarande osäkerheter;
- vilka delar som kan godkännas inom det givna mandatet.

Att läsa en förklaring, visa kod eller skapa en walk ger inget automatiskt godkännande. Undantag är ett separat, uttryckligt beslut. Öppna fynd ska vara synliga även när genomgångstäckningen är hög.

Granskningskraven ska vara begripliga och möjliga att välja. Den tidigare införda standarden ”din granskning eller agentgranskning” ska inte behandlas som ett redan godkänt beslut.

### 6. Bevara ansvarsfördelning och historik

Hosten äger revisionsunderlag, validering, granskningsstatus och historik. Agenten analyserar och förklarar genom den befintliga providerintegrationen och dess egna verktyg.

Analys och delegerad granskning behöver ett avgränsat uppdrag utan mandat att ändra projektkoden. Den befintliga verktygsfria reviewdiskussionen får inte tyst nya behörigheter. Exakt åtkomst för analysarbetet ska fastställas mot repots arkitekturbeslut inför implementation.

Walks, fördjupningar, fynd och beslut binds till den granskade versionen och bevaras efter omstart. Nya revisioner ersätter inte pågående underlag automatiskt.

### 7. Bedöm resultatet utifrån förståelse

Verifieringen ska omfatta både funktion och innehåll:

- Kodreferenser och täckning stämmer med revisionsparet.
- Fördjupningar använder rätt steg och kodkontext.
- Fönster, positioner och markeringar fungerar efter återöppning.
- Agentgodkännanden kräver ett faktiskt granskningsresultat och rätt mandat.
- Förklaringarna gör det lättare att förstå beteendet utan att dölja viktiga detaljer.

Det sista kräver ett verkligt användarprov. **Simulerade svar kan verifiera flödet, men inte kvaliteten på agentens förklaringar.** Bedömningen ska handla om huruvida du får grepp om ändringen och enkelt kan fördjupa dig — inte om ett kunskapstest.

Det befintliga DSP-116-exemplet bör också få sina förklaringar omarbetade enligt samma principer, kontrollerade mot den historiska kod det beskriver.

En lämplig sammanhållande storytitel är **”Förstå och granska ändringar genom agentgenererade code walks”**. Gerrit/GitHub-import, automatisk kodrättning och publicering av reviewbeslut ligger utanför denna story.
