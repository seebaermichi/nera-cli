---
layout: pages/default.pug
title: Kontakt
description: Schreib Brot & Zeit eine Nachricht oder komm direkt vorbei in Kreuzberg.
---

<section class="page-hero"><p class="eyebrow">IMMER EIN OFFENES OHR</p><h1>Ein Hallo,<br><em>ein Anliegen?</em></h1><p class="lead">Für Fragen, Bestellungen oder einfach einen netten Gruß – schreib uns.</p></section>
<section class="contact-layout"><form class="contact-form" id="contact-form"><label for="name">Dein Name</label><input id="name" name="name" autocomplete="name" required placeholder="Wie dürfen wir dich nennen?"><label for="email">Deine E-Mail</label><input id="email" name="email" type="email" autocomplete="email" required placeholder="du@beispiel.de"><label for="message">Deine Nachricht</label><textarea id="message" name="message" rows="5" required placeholder="Was liegt dir auf dem Herzen?"></textarea><button class="button" type="submit">Nachricht vorbereiten <span aria-hidden="true">↗</span></button><p class="form-note">Dein E-Mail-Programm öffnet sich mit deiner Nachricht. Du kannst sie dort noch prüfen und absenden.</p></form><aside class="contact-aside"><p class="eyebrow">KOMM LIEBER VORBEI?</p><p>Wir sind in der Bergmannstraße zu Hause – und freuen uns immer über ein Gesicht zur Stimme.</p><a href="/oeffnungszeiten.html" class="text-link">Öffnungszeiten & Anfahrt <span aria-hidden="true">→</span></a><p class="eyebrow contact-email-label">E-MAIL</p><a href="mailto:hallo@brotundzeit.example" class="text-link">hallo@brotundzeit.example <span aria-hidden="true">↗</span></a><p class="small-note">Die Kontaktdaten sind Beispielangaben und müssen vor Veröffentlichung ersetzt werden.</p></aside></section>
<script>
document.getElementById('contact-form').addEventListener('submit', function(event) { event.preventDefault(); const data = new FormData(this); const subject = encodeURIComponent('Nachricht von ' + data.get('name')); const body = encodeURIComponent(data.get('message') + '\n\nAntwort an: ' + data.get('email')); window.location.href = 'mailto:hallo@brotundzeit.example?subject=' + subject + '&body=' + body; });
</script>
