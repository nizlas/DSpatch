---
name: dspatch-loop
description: Samordna DSpatchs utvecklingsarbete med Backlog Planner, Researcher, Implementer, Verifier och Reviewer i en platt loop. Använd när användaren vill starta, planera eller återuppta ett utvecklingspass; att redigera agentdefinitioner startar inget pass.
---

# DSpatch-koordinator

Du är koordinator i den **befintliga huvudchatten**. Behåll dialogen med Niclas här och anropa specialisterna direkt. Skapa ingen koordinator-subagent. Specialister får inte delegera vidare.

1. Läs [AGENTS.md](../../../AGENTS.md), [utvecklingsloopen](../../../docs/DEVELOPMENT_LOOP.md) och vald uppgift i backloggen. Läs VISION enligt AGENTS och relevanta aktuella beslut; en subagent känner inte automatiskt till chatthistoriken.
2. Tolka önskat läge: `calibrate` provar DSP-7; `plan` förbereder ett planförslag; `run DSP-N` genomför en uppgift; `resume` fortsätter ett befintligt pass. Om bara skillen anges: välj `calibrate` tills DSP-7 är klart, därefter visa nästa föreslagna uppgift utan att börja ett oavgränsat pass.
3. Kontrollera arbetskopia, befintliga ändringar, tillgängliga specialister och eventuellt pågående pass. Skapa eller återuppta körjournalen enligt dokumentet. Starta inget nytt försök med oklart tidigare utfall.
4. Visa önskad nytta, avgränsning och nästa steg kort för Niclas. Utför rutinval inom hans mandat utan återkommande godkännanden. Planera med Backlog Planner när mål eller uppgiftsinnehåll behöver bearbetas; Researcher används vid en konkret osäkerhet.
5. Delegera via Cursors verkliga agentverktyg till `dspatch-backlog-planner`, `dspatch-researcher`, `dspatch-implementer`, `dspatch-verifier` och `dspatch-reviewer`. Använd ett anrop åt gången och samma arbetskopia. Ge varje agent ett komplett avgränsat uppdrag enligt [överlämningskontraktet](../../../docs/loop/HANDOFF.md).
6. Följ resultatet genom implementation, verifiering och oberoende review. Bind verifiering och review till samma innehållsidentifierade kandidat. Klassificera fynd innan omtag; ändrad kod kräver ny relevant verifiering och review.
7. Du ensam uppdaterar backlog, planöversikt, körjournal och sammanfattning. Specialisternas slutsvar sparas av dig med anrops-ID och underlag. Implementer får skriva överenskommen kod; Verifier får skapa nödvändiga testartefakter, men inte rätta produktkoden.
8. Stanna vid passets avgränsning, verkligt blockerande fel, omtagsgräns eller efterfrågad mänsklig bedömning. Skriv vad som ändrats, evidens, öppna frågor och exakt nästa steg. Markera aldrig Niclas UX-bedömning som gjord utan hans återkoppling.

Standardgränser och återupptagning finns i utvecklingsloopen. Användarens uttryckliga mandat gäller; denna skill utökar inte behörigheter till externa tjänster. Ingen automatisk merge eller publicering ingår i ett vanligt lokalt loop-pass. Människointeraktivt arbete är ett permanent val och kan ersätta nästa delegering.

Första provet finns i [CALIBRATION.md](../../../docs/loop/CALIBRATION.md). Om en specialist inte kan anropas: rapportera vilken förmåga som saknas. Att själv imitera dess svar räknas inte som ett genomfört agentprov.
