---
layout: pages/default.pug
title: Kontakt
description: Schreiben Sie Brot & Zeit – Fragen, Bestellungen und Feedback.
---
# Kontakt

Fragen, Bestellwünsche für Torten oder Großbestellungen? Schreiben Sie uns.

<form action="https://formspree.io/f/FORM_ID_EINTRAGEN" method="post">
  <label>Name <input type="text" name="name" required autocomplete="name"></label>
  <label>E-Mail <input type="email" name="email" required autocomplete="email"></label>
  <label>Nachricht <textarea name="message" rows="6" required></textarea></label>
  <label class="check"><input type="checkbox" required> <span>Ich habe die <a href="/datenschutz.html">Datenschutzerklärung</a> gelesen und bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verwendet werden.</span></label>
  <button type="submit">Nachricht senden</button>
</form>

<p class="hint">Hinweis für die Inhaberin / den Inhaber: Das Formular sendet über Formspree. Eine Form-ID muss noch eingetragen werden (siehe README).</p>
