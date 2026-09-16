/**
 * Tests d'ingestion multi-format (EX-01, cahier des charges §8).
 *
 * Les fichiers de `samples/` sont les fichiers RÉELS du projet, ceux-là mêmes
 * que le notebook traite au Module 8. L'OCR réel est exécuté sur l'image.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFileType, ingestFile, MIN_NATIVE_PDF_CHARS } from '@/lib/ingestor';

const SAMPLES = path.resolve(__dirname, '../../samples');
const read = (name: string) => fs.readFileSync(path.join(SAMPLES, name));

describe('Détection de format', () => {
  it('reconnaît les formats du contrat d’ingestion', () => {
    expect(detectFileType('a.jpg')).toBe('JPG');
    expect(detectFileType('a.JPEG')).toBe('JPEG');
    expect(detectFileType('a.png')).toBe('PNG');
    expect(detectFileType('a.pdf')).toBe('PDF');
    expect(detectFileType('a.json')).toBe('JSON');
    expect(detectFileType('a.txt')).toBe('TXT');
  });

  it('rejette un format non pris en charge', async () => {
    const r = await ingestFile(Buffer.from('x'), 'virus.exe');
    expect(r.fileType).toBe('UNKNOWN');
    expect(r.validationStatus).toBe('FAIL');
    expect(r.humanReviewStatus).toBe('REQUIRED');
    expect(r.errors[0]).toMatch(/Format non pris en charge/);
  });
});

describe('Ingestion TXT', () => {
  it('lit le fichier texte réel', async () => {
    const r = await ingestFile(read('sample_test_document.txt'), 'sample_test_document.txt');
    expect(r.validationStatus).toBe('PASS');
    expect(r.processingEngine).toBe('plain_text');
    expect(r.confidence).toBe(1);
    expect(r.extractedText.length).toBeGreaterThan(0);
    expect(r.humanReviewStatus).toBe('PASS');
  });

  it('place un texte vide en CLARIFICATION_REQUIRED sans rien inventer', async () => {
    const r = await ingestFile(Buffer.from('   \n  '), 'vide.txt');
    expect(r.validationStatus).toBe('CLARIFICATION_REQUIRED');
    expect(r.extractedText).toBe('');
    expect(r.structuredContent).toBeNull();
  });
});

describe('Ingestion JSON', () => {
  it('parse et valide le JSON réel', async () => {
    const r = await ingestFile(read('sample_test_document.json'), 'sample_test_document.json');
    expect(r.validationStatus).toBe('PASS');
    expect(r.processingEngine).toBe('json_parser');
    expect(r.structuredContent).not.toBeNull();
    expect(r.confidence).toBe(1);
  });

  it('rejette un JSON corrompu', async () => {
    const r = await ingestFile(Buffer.from('{"a": '), 'casse.json');
    expect(r.validationStatus).toBe('FAIL');
    expect(r.errors[0]).toMatch(/JSON invalide/);
    expect(r.humanReviewStatus).toBe('REQUIRED');
  });
});

describe('Ingestion PDF — natif d’abord, OCR en secours', () => {
  it('extrait le texte natif du PDF réel sans recourir à l’OCR', async () => {
    const r = await ingestFile(read('sample_test_document.pdf'), 'sample_test_document.pdf', {
      // L'OCR échouerait bruyamment s'il était appelé : il ne doit pas l'être.
      ocr: async () => {
        throw new Error('OCR ne doit pas être appelé quand le texte natif suffit');
      },
    });
    expect(r.validationStatus).toBe('PASS');
    expect(r.processingEngine).toBe('native_pdf');
    expect(r.extractedText.trim().length).toBeGreaterThanOrEqual(MIN_NATIVE_PDF_CHARS);
  });

  it('bascule vers l’OCR quand le texte natif est insuffisant', async () => {
    // PDF valide mais sans texte exploitable → bascule attendue.
    const blank = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
        'trailer<</Root 1 0 R>>\n%%EOF',
    );
    const r = await ingestFile(blank, 'scan.pdf', {
      ocr: async () => ({ text: 'TEXTE ISSU DE L OCR', confidence: 0.91 }),
    });
    expect(r.processingEngine).toBe('ocr');
    expect(r.extractedText).toContain('OCR');
  });

  it('parse le PDF réel dès le PREMIER appel du processus (régression XRef)', async () => {
    // Ce PDF a une table XRef malformée : pdf.js échouait au premier appel
    // d'un processus et ne se rétablissait qu'ensuite. Le moteur doit être
    // `native_pdf` même à froid.
    const r = await ingestFile(read('sample_test_document.pdf'), 'sample_test_document.pdf');
    expect(r.validationStatus).toBe('PASS');
    expect(r.processingEngine).toBe('native_pdf');
  });

  it('ne transmet jamais un PDF à tesseract par défaut et ne plante pas', async () => {
    // tesseract.js lève une erreur asynchrone non rattrapable sur un PDF :
    // sans OCR injecté, le PDF illisible doit être dégradé proprement.
    const r = await ingestFile(Buffer.from('%PDF-1.4\nillisible'), 'illisible.pdf');
    expect(r.validationStatus).toBe('CLARIFICATION_REQUIRED');
    expect(r.processingEngine).toBe('not_used');
    expect(r.humanReviewStatus).toBe('REQUIRED');
    expect(r.errors.join(' ')).toMatch(/rasterisation/);
  });

  it('exige une clarification si ni le natif ni l’OCR ne donnent de texte', async () => {
    const r = await ingestFile(Buffer.from('%PDF-1.4\ncorrompu'), 'illisible.pdf', {
      ocr: async () => ({ text: '', confidence: 0 }),
    });
    expect(['CLARIFICATION_REQUIRED', 'FAIL']).toContain(r.validationStatus);
    expect(r.humanReviewStatus).toBe('REQUIRED');
  });
});

describe('Seuil de confiance HITL', () => {
  it('route vers la revue humaine sous le seuil de 0,85', async () => {
    const r = await ingestFile(read('sample_id_and_license.jpg'), 'faible.jpg', {
      ocr: async () => ({ text: 'texte peu fiable', confidence: 0.42 }),
    });
    expect(r.validationStatus).toBe('PASS');
    expect(r.humanReviewStatus).toBe('REQUIRED');
    expect(r.errors.join(' ')).toMatch(/revue humaine requise/);
  });

  it('ne déclenche pas de revue au-dessus du seuil', async () => {
    const r = await ingestFile(read('sample_id_and_license.jpg'), 'fiable.jpg', {
      ocr: async () => ({ text: 'texte fiable', confidence: 0.97 }),
    });
    expect(r.humanReviewStatus).toBe('PASS');
  });
});

describe('OCR réel sur l’image du projet', () => {
  it(
    'extrait du texte de sample_id_and_license.jpg avec tesseract.js',
    async () => {
      const r = await ingestFile(read('sample_id_and_license.jpg'), 'sample_id_and_license.jpg');
      expect(r.processingEngine).toBe('ocr');
      expect(r.extractedText.trim().length).toBeGreaterThan(0);
      expect(r.confidence).toBeGreaterThan(0);
    },
    { timeout: 180_000 },
  );
});
