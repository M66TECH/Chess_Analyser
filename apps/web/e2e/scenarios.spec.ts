import { test, expect } from '@playwright/test';

test.describe('Chess Analyzer — E2E Critical Scenarios (P1.6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('cg-board')).toBeVisible();
  });

  test('Scénario 1: Déplacement d\'une pièce et mise à jour de l\'historique', async ({ page }) => {
    const board = page.locator('cg-board');
    const box = await board.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      const sq = box.width / 8;
      // Click e2 (file e = 4, rank 2 from bottom)
      const e2X = box.x + 4.5 * sq;
      const e2Y = box.y + 6.5 * sq;
      // Click e4 (file e = 4, rank 4 from bottom)
      const e4X = box.x + 4.5 * sq;
      const e4Y = box.y + 4.5 * sq;

      await page.mouse.click(e2X, e2Y);
      await page.mouse.click(e4X, e4Y);
    }

    // Verify move e4 is registered
    await expect(page.getByText('e4').first()).toBeVisible({ timeout: 5000 });
  });

  test('Scénario 2: Navigation clavier (Flèche gauche / droite)', async ({ page }) => {
    const board = page.locator('cg-board');
    const box = await board.boundingBox();
    if (box) {
      const sq = box.width / 8;
      await page.mouse.click(box.x + 4.5 * sq, box.y + 6.5 * sq);
      await page.mouse.click(box.x + 4.5 * sq, box.y + 4.5 * sq);
    }
    await expect(page.getByText('e4').first()).toBeVisible({ timeout: 5000 });

    // Press ArrowLeft to navigate back to starting position
    await page.keyboard.press('ArrowLeft');
    // Press ArrowRight to navigate forward
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('e4').first()).toBeVisible();
  });

  test('Scénario 3: Importation d\'une partie PGN', async ({ page, isMobile }) => {
    await page.getByRole('button', { name: 'Importer PGN' }).click();

    const modalHeading = page.getByRole('heading', { name: /Importer une partie/i });
    await expect(modalHeading).toBeVisible();

    const samplePgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6';
    const textarea = page.getByLabel('Texte PGN à analyser');
    await textarea.fill(samplePgn);

    await page.getByRole('button', { name: 'Analyser la partie' }).click();

    await expect(modalHeading).not.toBeVisible();

    if (isMobile) {
      await page.getByRole('button', { name: 'Coups' }).click();
    }

    await expect(page.getByText('Bb5').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Scénario 4: Mode Local Strict (P3.14)', async ({ page }) => {
    const localButton = page.getByRole('button', { name: /Activer le mode local|Désactiver le mode local/i });
    await expect(localButton).toBeVisible();

    await localButton.click();
    await expect(localButton).toHaveAttribute('aria-pressed', 'true');

    await localButton.click();
    await expect(localButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('Scénario 5: Responsive mobile et onglets tactiles', async ({ page, isMobile }) => {
    if (!isMobile) return;

    await expect(page.locator('cg-board')).toBeVisible();

    const coachTab = page.getByRole('button', { name: 'Coach' });
    const movesTab = page.getByRole('button', { name: 'Coups' });
    const explorerTab = page.getByRole('button', { name: 'Base' });

    await expect(coachTab).toBeVisible();
    await expect(movesTab).toBeVisible();
    await expect(explorerTab).toBeVisible();

    await movesTab.click();
    await expect(movesTab).toHaveAttribute('aria-pressed', 'true');

    await explorerTab.click();
    await expect(explorerTab).toHaveAttribute('aria-pressed', 'true');
  });
});
