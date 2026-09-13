---
id: m-0
title: "Etapp 0 – Gör en verklig kodändring med DSpatch"
---

## Description

DSP-7 är ett förberedelsesteg: prova utvecklingsloopen i Cursor och bedöm dess planering innan DSP-1 genomförs med loopen. Produktens slutmål nedan uppnås genom DSP-1–6; kalibreringen ersätter inget av deras kriterier.

Förslag utifrån VISION.md avsnitt 14–15 och Niclas beslut den 13 september 2026. Efter DSP-6 ska Niclas kunna välja ett repo, diskutera en liten utvecklingsuppgift, låta agenten ändra koden, granska berörda filer och en fullständig vanlig textdiff samt köra relevant bygge eller test och se resultatet för rätt kodversion. Följdfrågor, omtag, avbrott, begriplig felhantering och fortsatt arbete efter omstart ingår.

Tidigare manuella ändringar ska bevaras. Granskade ändringar och körresultat ska finnas kvar efter omstart, med tydlig skillnad mellan historiska resultat och arbetskopians nuvarande innehåll. Omstart eller återanslutning får inte automatiskt upprepa ett ändringsuppdrag eller körkommando.

Milstolpen är uppnådd när hela detta förlopp är tekniskt verifierat på Windows, Niclas har bedömt det i verklig användning och eventuella hinder för vardagsanvändning har hanterats eller uttryckligen accepterats. Niclas kan ge tidig återkoppling redan på den första chatten. DSP-5 provar kodändring, diff och bygge/test så snart DSP-2 bär hela flödet; DSP-6 följer upp det sammanförda resultatet med felåterhämtning och omstart.

TypeScript, React och Electron är valt teknikspår. Första implementationen och testningen sker med Cursor på Niclas Windowsdator. DSP-1 verifierar teknikspåret och väljer och provar den konkreta anslutningsvägen, inklusive ett minimalt paketerat Windowsprov. Windows och Linux ingår i målbilden med en enhetlig arbetsyta; Linuxstödet införs stegvis och Linuxprov krävs inte för denna milstolpe. VS Code/Copilot ska fortsatt stödjas i målbilden och beaktas i teknikvalen, men behöver inte implementeras eller provköras för att uppnå denna milstolpe. Avancerad kodförståelse, en egen editor, autonom produktloop, komplett kostnadsredovisning och externa planeringsadaptrar ingår i senare etapper. Automatisk commit, push och PR-hantering krävs inte i Etapp 0.
