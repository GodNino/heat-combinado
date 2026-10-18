import { test } from "node:test";
import assert from "node:assert/strict";
import { translateText } from "../lib/i18n-es.ts";

test("interface text turns Spanish and keeps the spaces around it", () => {
  assert.equal(translateText("Home"), "Inicio");
  assert.equal(translateText("  Take the tour "), "  Ver el tour ");
  assert.equal(translateText("Sign in to prepare your team for the next service."), "Inicia sesión para preparar a tu equipo para el próximo servicio.");
});

test("allergens read in Spanish everywhere, including capital badges and CC notes", () => {
  assert.equal(translateText("Shellfish"), "Mariscos");
  assert.equal(translateText("FISH"), "PESCADO");
  assert.equal(translateText("Sesame (CC)"), "Ajonjolí (CC)");
});

test("the automatic quiz's questions keep the dish name", () => {
  assert.equal(translateText("Which menu category contains Yellowtail Tiradito?"), "¿En qué categoría del menú está Yellowtail Tiradito?");
  assert.equal(translateText("What do the recorded allergen notes say for Crispy Rice? (CC means cross-contamination.)"), "¿Qué dicen las notas de alérgenos de Crispy Rice? (CC significa contaminación cruzada.)");
  assert.equal(translateText("Free trial · 1 day left"), "Prueba gratis · queda 1 día");
  assert.equal(translateText("Submit dinner report"), "Enviar reporte de cena");
});

test("what a restaurant writes, and anything unknown, is left exactly as it is", () => {
  assert.equal(translateText("Yellowtail Tiradito"), null);
  assert.equal(translateText("Thin-sliced yellowtail dressed at the pass with citrus soy."), null);
  assert.equal(translateText("   "), null);
});
