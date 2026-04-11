/**
 * Relatório institucional (PDF + Excel) — mesmo código do admin (_simGeneratePDF / _gerarRelatorioExcel).
 * No painel do coordenador usa opts.prefill (sem Supabase no browser).
 */
(function () {
  function coordPrepareInstitutionalExport() {
    const ctx = window.__MEDCOF_SIM_EXPORT__;
    if (!ctx || !ctx.alunosSorted || !ctx.alunosSorted.length) {
      alert('Nenhum resultado para exportar neste simulado.');
      return null;
    }
    const slug = ctx.slug;
    const name = (window.CURRENT_INSTITUTION && window.CURRENT_INSTITUTION.institutionName) || slug;
    const simTitle = ctx.titulo || '';
    const alunos = ctx.alunosSorted.map(function (a) {
      var resps = a.resps;
      if (Array.isArray(resps)) resps = resps.join('');
      else resps = String(resps || '');
      return Object.assign({}, a, { resps: resps });
    });
    var questions = (ctx.questions || []).map(function (q) {
      return Object.assign({}, q, { area: q.area || q.grande_area });
    });
    const areaNames = Array.from(new Set(questions.map(function (q) { return q.area; }).filter(Boolean)));
    const areaStats = areaNames.map(function (area) {
      const vals = alunos.map(function (a) { return a.areas ? a.areas[area] : null; }).filter(function (v) { return v != null; });
      const avg = vals.length ? vals.reduce(function (s, v) { return s + v; }, 0) / vals.length : 0;
      return { label: area, pct_ies: avg };
    }).sort(function (a, b) { return b.pct_ies - a.pct_ies; });
    const scores = alunos.map(function (a) { return a.nota || 0; });
    const totalAlunos = alunos.length;
    const mediaIES = scores.reduce(function (s, x) { return s + x; }, 0) / totalAlunos;
    const profCount = alunos.filter(function (a) { return a.nota >= 60; }).length;
    const quaseCount = alunos.filter(function (a) { return a.nota >= 49 && a.nota < 60; }).length;
    const urgCount = alunos.filter(function (a) { return a.nota < 49; }).length;
    const bins = Array(10).fill(0);
    scores.forEach(function (s) {
      bins[Math.min(Math.floor(s / 10), 9)]++;
    });
    var corHex = (localStorage.getItem('simPdfCor_' + slug) || '#B01B1B').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(corHex)) corHex = '#B01B1B';
    return {
      slug: slug,
      name: name,
      corHex: corHex,
      alunos: alunos,
      questions: questions,
      simTitle: simTitle,
      areaStats: areaStats,
      bins: bins,
      totalAlunos: totalAlunos,
      mediaIES: mediaIES,
      profCount: profCount,
      quaseCount: quaseCount,
      urgCount: urgCount
    };
  }

  window.coordPrepareInstitutionalExport = coordPrepareInstitutionalExport;

  window.coordExportInstitutionalPdf = async function () {
    const p = coordPrepareInstitutionalExport();
    if (!p) return;
    await window._coordSimGeneratePDF(p.slug, null, { prefill: p, pdfOnly: true });
  };

  window.coordExportInstitutionalExcel = async function () {
    const p = coordPrepareInstitutionalExport();
    if (!p) return;
    await window._coordSimGeneratePDF(p.slug, null, { prefill: p, excelOnly: true });
  };

  window._coordSimGeneratePDF = async function(slug, simId, opts) {
    opts = opts || {};
    let name, corHex;
    if (opts.prefill) {
      const p = opts.prefill;
      name = p.name;
      corHex = String(p.corHex || '#B01B1B').trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(corHex)) {
        alert('Cor hexadecimal inválida.');
        return;
      }
      localStorage.setItem('simPdfCor_' + slug, corHex);
    } else {
      const ds = window.INSTITUTION_DATASETS || {};
      const inst = ds[slug] || {};
      const instData = (window._instData || []).find(i => i.slug === slug);
      name = inst.institutionName || instData?.nome || slug.toUpperCase();
      corHex = opts.blobsOnly
        ? String(localStorage.getItem('simPdfCor_' + slug) || instData?.theme_hex || '#B01B1B').trim()
        : (($("simPdfCorHex") && $("simPdfCorHex").value ? $("simPdfCorHex").value : '').trim() || localStorage.getItem('simPdfCor_'+slug) || instData?.theme_hex || '#B01B1B');
      if(!/^#[0-9a-fA-F]{6}$/.test(corHex)) { alert('Cor hexadecimal inválida.'); return; }
      localStorage.setItem('simPdfCor_'+slug, corHex);
    }

    // Load jsPDF
    if(typeof window.jspdf==='undefined') {
      const ls = s => new Promise((r,j) => { const e=document.createElement('script');e.src=s;e.onload=r;e.onerror=j;document.head.appendChild(e); });
      await ls('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      await ls('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js');
    }
    const jsPDF = window.jspdf?.jsPDF; if(!jsPDF) { alert('Erro ao carregar biblioteca PDF.'); return; }

    // Parse color
    const hx = s => { const m=s.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); return m?[parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)]:[176,27,27]; };
    const ACCENT = hx(corHex);

    // Colors
    const WH=[255,255,255], BG=[247,248,252], TEXT=[20,22,38], SOFT=[72,77,102], MUTED=[140,145,168];
    const DARK=[26,30,52], CARD=[237,240,250], BORD=[198,203,220], GREEN=[22,128,60];

    // ── Load data: painel coordenador (prefill) ou admin (Supabase) ──
    let alunos = [], questions = [], simTitle = '';
    if (opts.prefill) {
      alunos = opts.prefill.alunos || [];
      questions = opts.prefill.questions || [];
      simTitle = opts.prefill.simTitle || '';
    } else if (simId) {
      const simRef = `bq_${slug}_${simId.slice(0,8)}`;
      try {
        const rows = await _supaRest('simulado_respostas',
          `select=aluno_nome,respostas&simulado_ref=eq.${encodeURIComponent(simRef)}&ies_slug=eq.${encodeURIComponent(slug)}`);
        const meta = rows.find(r => r.aluno_nome === '__META__');
        if (meta?.respostas) {
          questions = meta.respostas.questions || [];
          simTitle = meta.respostas.titulo || '';
        }
        const batches = rows.filter(r => r.aluno_nome.startsWith('__BATCH_'));
        alunos = batches.flatMap(b => b.respostas?.alunos || []);
      } catch(e) { console.error('Erro ao carregar dados BQ:', e); }
    }

    if (!alunos.length) {
      alert('Nenhum resultado encontrado. Faça o upload do resultado primeiro.'); return;
    }

    // Sort by nota desc
    alunos.sort((a, b) => (b.nota || 0) - (a.nota || 0));
    const totalAlunos = alunos.length;
    const mediaIES = alunos.reduce((s, a) => s + (a.nota || 0), 0) / totalAlunos;

    // Areas from questions metadata
    const areaNames = [...new Set(questions.map(q => q.area).filter(Boolean))];
    const areaStats = areaNames.map(area => {
      const vals = alunos.map(a => a.areas?.[area]).filter(v => v != null);
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      return { label: area, pct_ies: avg };
    }).sort((a, b) => b.pct_ies - a.pct_ies);

    // Distribution bins
    const scores = alunos.map(a => a.nota || 0);
    const bins = Array(10).fill(0);
    scores.forEach(s => { const b = Math.min(Math.floor(s / 10), 9); bins[b]++; });

    // Proficiency bands
    const profCount = alunos.filter(a => a.nota >= 60).length;
    const quaseCount = alunos.filter(a => a.nota >= 49 && a.nota < 60).length;
    const urgCount = alunos.filter(a => a.nota < 49).length;

    // Logo
    let logoDataUrl = null;
    try {
      const img = new Image(); img.crossOrigin = 'anonymous';
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `${slug}/logo_${slug}.png`; setTimeout(rej, 3000); });
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext('2d').drawImage(img, 0, 0);
      logoDataUrl = cv.toDataURL('image/png');
    } catch(e) {}

    // ── BUILD PDF ──
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, PL = 18, PR = 18, PW = W - PL - PR;
    let y, pageNum = 0;
    function pageBg() { doc.setFillColor(...BG); doc.rect(0, 0, W, 297, 'F'); }
    function newPage() { if (pageNum > 0) doc.addPage(); pageBg(); pageNum++; y = 20; }
    function checkY(n = 20) { if (y + n > 275) { footer(); newPage(); } }
    function footer() { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(`${name} × MedCof · ${simTitle || 'Relatório de Simulado'} · Página ${pageNum}`, W / 2, 291, { align: 'center' }); doc.setFillColor(...ACCENT); doc.rect(0, 293, W, 2, 'F'); }
    function sectionHdr(num, title) { checkY(16); doc.setFillColor(...DARK); doc.rect(PL - 2, y - 5, PW + 4, 11, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...WH); doc.text(`${num}. ${title}`, PL + 2, y + 2); y += 14; }

    // ═══ CAPA ═══
    newPage();
    doc.setFillColor(...DARK); doc.rect(0, 0, W, 58, 'F');
    doc.setFillColor(...ACCENT); doc.rect(0, 58, W, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...WH);
    doc.text((simTitle || 'RELATÓRIO DE SIMULADO').toUpperCase(), logoDataUrl ? PL : W / 2, 22, { align: logoDataUrl ? 'left' : 'center' });
    doc.setFontSize(10); doc.setTextColor(190, 200, 225);
    doc.text(`${name} | ${totalAlunos} alunos | ${questions.length} questões`, logoDataUrl ? PL : W / 2, 34, { align: logoDataUrl ? 'left' : 'center' });
    doc.setFontSize(8.5); doc.setTextColor(160, 175, 200);
    doc.text(`${new Date().toLocaleDateString('pt-BR')} · MedCof B2B · Uso restrito`, logoDataUrl ? PL : W / 2, 43, { align: logoDataUrl ? 'left' : 'center' });
    if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'PNG', W - PR - 30, 12, 30, 30); } catch(e) {} }

    // Stat boxes
    y = 72;
    const statCards = [
      { label: 'Alunos avaliados', val: String(totalAlunos) },
      { label: 'Média institucional', val: mediaIES.toFixed(1) + '%' },
      { label: 'Proficientes (≥60)', val: profCount + ' (' + (profCount / totalAlunos * 100).toFixed(0) + '%)' },
      { label: 'Grandes áreas', val: String(areaStats.length) }
    ];
    const cW = PW / statCards.length;
    statCards.forEach((c, i) => {
      const cx = PL + i * cW;
      doc.setFillColor(...DARK); doc.roundedRect(cx + 2, y, cW - 4, 28, 3, 3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...WH);
      doc.text(c.val, cx + cW / 2, y + 13, { align: 'center' });
      doc.setFontSize(7); doc.setTextColor(...MUTED);
      doc.text(c.label, cx + cW / 2, y + 22, { align: 'center' });
    });
    y += 38;

    // Area coverage bars
    if (areaStats.length) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...TEXT);
      doc.text('Desempenho por Área', PL, y); y += 6;
      areaStats.forEach(a => {
        checkY(10);
        const barW = PW * 0.6; const pct = Math.min(a.pct_ies / 100, 1);
        doc.setFillColor(...CARD); doc.roundedRect(PL, y, barW, 7, 2, 2, 'F');
        doc.setFillColor(...(a.pct_ies >= 60 ? GREEN : ACCENT)); doc.roundedRect(PL, y, Math.max(barW * pct, 2), 7, 2, 2, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...TEXT);
        doc.text(a.label, PL + barW + 4, y + 5);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...(a.pct_ies >= 60 ? GREEN : ACCENT));
        doc.text(a.pct_ies.toFixed(1) + '%', PL + barW * pct - 1, y + 5, { align: 'right' });
        y += 10;
      });
    }
    footer();

    // ═══ PÁG 2: RANKING ═══
    newPage();
    sectionHdr('1', 'Ranking Geral dos Alunos');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...SOFT);
    doc.text('Ranking ordenado por nota no simulado.', PL, y); y += 6;

    const rankRows = alunos.map((a, i) => {
      const band = a.nota >= 60 ? 'Prof.' : a.nota >= 49 ? 'Quase' : 'Atenção';
      return [i + 1, a.nome || '', a.nota?.toFixed(1) + '%', band];
    });

    doc.autoTable({
      startY: y, margin: { left: PL, right: PR },
      head: [['#', 'Nome', 'Nota', 'Faixa']],
      body: rankRows,
      styles: { fontSize: 7, cellPadding: 2.5, textColor: TEXT, lineColor: BORD, lineWidth: 0.2 },
      headStyles: { fillColor: DARK, textColor: WH, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: CARD },
      columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 2: { cellWidth: 18, halign: 'center', fontStyle: 'bold' }, 3: { cellWidth: 20, halign: 'center' } },
      didParseCell: function(data) {
        if (data.section === 'body' && data.column.index === 3) {
          const v = data.cell.raw;
          if (v === 'Prof.') data.cell.styles.textColor = GREEN;
          else if (v === 'Quase') data.cell.styles.textColor = [245, 158, 11];
          else data.cell.styles.textColor = [220, 38, 38];
        }
      },
      didDrawPage: function() { footer(); }
    });
    y = doc.lastAutoTable.finalY + 10;

    // ═══ PÁG 3: DISTRIBUIÇÃO + ÁREAS ═══
    newPage();
    sectionHdr('2', 'Distribuição de Notas');
    const faixas = ['0–9', '10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80–89', '90–100'];
    const maxBin = Math.max(...bins, 1);
    faixas.forEach((f, i) => {
      checkY(8);
      const barW = PW * 0.5; const pct = bins[i] / maxBin;
      const isProf = i >= 6;
      doc.setFillColor(...CARD); doc.roundedRect(PL + 30, y, barW, 6, 2, 2, 'F');
      doc.setFillColor(...(isProf ? GREEN : ACCENT));
      if (pct > 0) doc.roundedRect(PL + 30, y, Math.max(barW * pct, 2), 6, 2, 2, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...SOFT);
      doc.text(f, PL + 27, y + 4.5, { align: 'right' });
      doc.setTextColor(...TEXT); doc.setFont('helvetica', 'bold');
      doc.text(String(bins[i]), PL + 30 + barW + 4, y + 4.5);
      y += 9;
    });
    y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...TEXT);
    doc.text(`Proficientes (≥60): ${profCount} (${(profCount / totalAlunos * 100).toFixed(0)}%)  ·  Quase (49-59): ${quaseCount} (${(quaseCount / totalAlunos * 100).toFixed(0)}%)  ·  Atenção (<49): ${urgCount} (${(urgCount / totalAlunos * 100).toFixed(0)}%)`, PL, y);
    y += 12;

    // Áreas detalhadas
    if (areaStats.length) {
      sectionHdr('3', 'Desempenho por Grande Área');
      const areaRows = areaStats.map(a => [a.label, a.pct_ies.toFixed(1) + '%', a.pct_ies >= 60 ? 'Acima' : 'Abaixo']);
      doc.autoTable({
        startY: y, margin: { left: PL, right: PR },
        head: [['Área', '% Acerto IES', 'Posição']], body: areaRows,
        styles: { fontSize: 7.5, cellPadding: 3, textColor: TEXT, lineColor: BORD, lineWidth: 0.2 },
        headStyles: { fillColor: DARK, textColor: WH, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: CARD },
        columnStyles: { 1: { halign: 'center', fontStyle: 'bold' }, 2: { halign: 'center' } },
        didParseCell: function(d) { if (d.section === 'body' && d.column.index === 2) { d.cell.styles.textColor = d.cell.raw === 'Acima' ? GREEN : [220, 38, 38]; } },
        didDrawPage: function() { footer(); }
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ═══ PÁG 4: ANÁLISE PEDAGÓGICA ═══
    newPage();
    sectionHdr('4', 'Análise Pedagógica e Recomendações');
    const profPct = (profCount / totalAlunos * 100).toFixed(0);
    const bestArea = areaStats.length ? areaStats[0] : null;
    const worstArea = areaStats.length ? areaStats[areaStats.length - 1] : null;

    const paragraphs = [
      `Este relatório apresenta o desempenho dos ${totalAlunos} alunos da ${name} no simulado "${simTitle}". A média institucional é de ${mediaIES.toFixed(1)}%.`,
      `Do total de alunos avaliados, ${profPct}% atingiram o critério de proficiência (nota ≥ 60). ${quaseCount} alunos estão na faixa de quase proficientes (49-59) e representam o grupo com maior potencial de conversão imediata. ${urgCount} alunos requerem atenção urgente (nota < 49).`,
      bestArea ? `A área de melhor desempenho foi ${bestArea.label} (${bestArea.pct_ies.toFixed(1)}% de acerto). ${worstArea && worstArea.label !== bestArea.label ? `A área de menor desempenho foi ${worstArea.label} (${worstArea.pct_ies.toFixed(1)}%), demandando reforço pedagógico direcionado.` : ''}` : ''
    ];

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SOFT);
    paragraphs.filter(Boolean).forEach(p => {
      checkY(20);
      const lines = doc.splitTextToSize(p, PW);
      doc.text(lines, PL, y); y += lines.length * 4 + 4;
    });

    y += 4; checkY(30);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...ACCENT);
    doc.text('Conclusão para a Coordenação', PL, y); y += 6;

    const redFlags = alunos.filter(a => a.nota < 49);
    const yellowFlags = alunos.filter(a => a.nota >= 49 && a.nota < 60);
    const conclusao = [
      `1. Priorizar acompanhamento dos ${redFlags.length} alunos em atenção urgente com plano semanal individualizado.`,
      `2. Direcionar os ${yellowFlags.length} alunos quase proficientes para revisão estratégica — são o grupo de maior conversão.`,
      `3. ${profCount} alunos proficientes devem ser reconhecidos como referência positiva da turma.`,
      worstArea ? `4. Intensificar o estudo dirigido em ${worstArea.label} — área de menor rendimento da turma.` : null,
    ].filter(Boolean);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...TEXT);
    conclusao.forEach(c => {
      checkY(8);
      const lines = doc.splitTextToSize(c, PW);
      doc.text(lines, PL, y); y += lines.length * 4 + 3;
    });
    footer();

    const baseName = `Relatorio_${name.replace(/[^a-zA-Z0-9]/g, '_')}_${(simTitle || 'simulado').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}`;

    if (opts.pdfOnly) {
      doc.save(baseName + '.pdf');
      return;
    }
    if (opts.excelOnly) {
      try {
        await window._coordGerarRelatorioExcel({
          alunos, questions, areaStats, bins, name, simTitle, totalAlunos, mediaIES, profCount, quaseCount, urgCount, baseName
        });
      } catch (exErr) { console.warn('Excel não gerado:', exErr); }
      return;
    }

    if (opts.blobsOnly) {
      const pdfBlob = doc.output('blob');
      let xlsxBlob = null;
      try {
        xlsxBlob = await window._coordGerarRelatorioExcel({
          alunos, questions, areaStats, bins, name, simTitle, totalAlunos, mediaIES, profCount, quaseCount, urgCount, baseName,
          returnBlob: true
        });
      } catch (exErr) { console.warn('Excel não gerado:', exErr); }
      return { pdfBlob, xlsxBlob, baseName, simTitle, name };
    }

    doc.save(baseName + '.pdf');
    try {
      await window._coordGerarRelatorioExcel({ alunos, questions, areaStats, bins, name, simTitle, totalAlunos, mediaIES, profCount, quaseCount, urgCount, baseName });
    } catch(exErr) { console.warn('Excel não gerado:', exErr); }

    if (typeof window.$ === 'function' && window.$('simPdfModal')) window.$('simPdfModal').style.display = 'none';
  };

  const _REL_XL = {
    headerBg: 'FF1A1A1A',
    headerFont: 'FFFFFFFF',
    accentSection: 'FFC46A6A',
    accentFont: 'FFFFFFFF',
    labelRow: 'FFF5F5F5',
    stripeA: 'FFF9F9F9',
    stripeB: 'FFFFFFFF',
    green: 'FFD5F5E3',
    yellow: 'FFFEF9E7',
    red: 'FFFADBD8',
    nameCol: 'FFEAF7EE',
    thinBorder: { top: { style: 'thin', color: { argb: 'FFE0E0E0' } }, left: { style: 'thin', color: { argb: 'FFE0E0E0' } }, bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } }, right: { style: 'thin', color: { argb: 'FFE0E0E0' } } }
  };

  async function _ensureExcelJSRel() {
    if (typeof ExcelJS !== 'undefined') return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // ── GERAÇÃO DO EXCEL INSTITUCIONAL (ExcelJS — formatação tipo planilha “Formatado”) ──
  window._coordGerarRelatorioExcel = async function({ alunos, questions, areaStats, bins, name, simTitle, totalAlunos, mediaIES, profCount, quaseCount, urgCount, baseName, returnBlob }) {
    await _ensureExcelJSRel();
    const dt = new Date().toLocaleDateString('pt-BR');
    const scores = alunos.map(a => a.nota || 0);
    const sorted = [...scores].sort((a, b) => a - b);
    const p = pct => sorted[Math.floor(sorted.length * pct / 100)] || 0;
    const stddev = (() => { const m = mediaIES; const v = scores.reduce((s, x) => s + (x-m)**2, 0) / scores.length; return Math.sqrt(v); })();
    const mediana = sorted.length % 2 === 0 ? (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2 : sorted[Math.floor(sorted.length/2)];
    const maiorNota = Math.max(...scores), menorNota = Math.min(...scores);
    const taxaProf = (profCount / totalAlunos * 100);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'MedCof';
    const alunosSorted = [...alunos].sort((a, b) => (b.nota||0) - (a.nota||0));

    // ── ABA Resumo ──
    const ws1 = wb.addWorksheet('Resumo', { views: [{ showGridLines: true }] });
    ws1.columns = [{ width: 36 }, { width: 64 }];
    ws1.mergeCells(1, 1, 1, 2);
    const cTitle = ws1.getCell(1, 1);
    cTitle.value = 'RELATÓRIO DE SIMULADO — ANÁLISE ESTATÍSTICA';
    cTitle.font = { bold: true, size: 16, name: 'Arial', color: { argb: _REL_XL.headerFont } };
    cTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: _REL_XL.headerBg } };
    cTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 28;

    const pairRows = [
      ['Instituição', name],
      ['Simulado', simTitle || '—'],
      ['Data do relatório', dt]
    ];
    let r = 3;
    pairRows.forEach(([lab, val]) => {
      ws1.getCell(r, 1).value = lab;
      ws1.getCell(r, 2).value = val;
      [1, 2].forEach(col => {
        const c = ws1.getCell(r, col);
        c.font = { bold: col === 1, size: 11, name: 'Arial', color: { argb: 'FF1A1A1A' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: _REL_XL.labelRow } };
        c.alignment = { horizontal: col === 2 ? 'right' : 'left', vertical: 'middle' };
        c.border = _REL_XL.thinBorder;
      });
      r++;
    });

    r++;
    ws1.mergeCells(r, 1, r, 2);
    const secM = ws1.getCell(r, 1);
    secM.value = 'MÉTRICAS GERAIS';
    secM.font = { bold: true, size: 12, name: 'Arial', color: { argb: _REL_XL.accentFont } };
    secM.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: _REL_XL.accentSection } };
    secM.alignment = { horizontal: 'left', vertical: 'middle' };
    r++;

    const metricPairs = [
      ['Total de alunos avaliados', totalAlunos],
      ['Média institucional (%)', +mediaIES.toFixed(2)],
      ['Mediana (%)', +mediana.toFixed(2)],
      ['Desvio padrão (%)', +stddev.toFixed(2)],
      ['Maior nota (%)', +maiorNota.toFixed(2)],
      ['Menor nota (%)', +menorNota.toFixed(2)],
      ['P25 — 1º Quartil (%)', +p(25).toFixed(2)],
      ['P75 — 3º Quartil (%)', +p(75).toFixed(2)],
      ['Coeficiente de variação (%)', +(stddev/mediaIES*100).toFixed(2)]
    ];
    metricPairs.forEach((row, idx) => {
      const bg = idx % 2 === 0 ? _REL_XL.stripeA : _REL_XL.stripeB;
      ws1.getCell(r, 1).value = row[0];
      ws1.getCell(r, 2).value = row[1];
      [1, 2].forEach(col => {
        const c = ws1.getCell(r, col);
        c.font = { bold: col === 2, size: 11, name: 'Arial', color: { argb: 'FF1A1A1A' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.alignment = { horizontal: col === 2 ? 'right' : 'left', vertical: 'middle' };
        c.border = _REL_XL.thinBorder;
      });
      r++;
    });

    r++;
    ws1.mergeCells(r, 1, r, 2);
    const secP = ws1.getCell(r, 1);
    secP.value = 'PROFICIÊNCIA';
    secP.font = { bold: true, size: 12, name: 'Arial', color: { argb: _REL_XL.accentFont } };
    secP.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: _REL_XL.accentSection } };
    r++;

    [['Proficientes (nota ≥ 60%)', profCount], ['Taxa de proficiência (%)', +taxaProf.toFixed(2)], ['Quase proficientes (49–59%)', quaseCount], ['Atenção urgente (< 49%)', urgCount]].forEach((row, idx) => {
      const bg = idx % 2 === 0 ? _REL_XL.stripeA : _REL_XL.stripeB;
      ws1.getCell(r, 1).value = row[0];
      ws1.getCell(r, 2).value = row[1];
      [1, 2].forEach(col => {
        const c = ws1.getCell(r, col);
        c.font = { bold: col === 2, size: 11, name: 'Arial' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.alignment = { horizontal: col === 2 ? 'right' : 'left', vertical: 'middle' };
        c.border = _REL_XL.thinBorder;
      });
      r++;
    });

    r++;
    ws1.mergeCells(r, 1, r, 2);
    const secI = ws1.getCell(r, 1);
    secI.value = 'INSTRUMENTO';
    secI.font = { bold: true, size: 12, name: 'Arial', color: { argb: _REL_XL.accentFont } };
    secI.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: _REL_XL.accentSection } };
    r++;
    [['Total de questões', questions.length], ['Grandes áreas cobertas', areaStats.length]].forEach((row, idx) => {
      const bg = idx % 2 === 0 ? _REL_XL.stripeA : _REL_XL.stripeB;
      ws1.getCell(r, 1).value = row[0];
      ws1.getCell(r, 2).value = row[1];
      [1, 2].forEach(col => {
        const c = ws1.getCell(r, col);
        c.font = { bold: col === 2, size: 11, name: 'Arial' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.alignment = { horizontal: col === 2 ? 'right' : 'left', vertical: 'middle' };
        c.border = _REL_XL.thinBorder;
      });
      r++;
    });

    // ── Ranking ──
    const ws2 = wb.addWorksheet('Ranking Alunos');
    const rankHeader = ['Posição', 'Nome', 'Turma', 'Nota (%)', 'Faixa', 'Z-Score', 'Percentil Aprox.'];
    const rankRows = alunosSorted.map((a, i) => {
      const nota = a.nota || 0;
      const faixa = nota >= 60 ? 'Proficiente' : nota >= 49 ? 'Quase proficiente' : 'Atenção';
      const zscore = stddev > 0 ? +((nota - mediaIES) / stddev).toFixed(3) : 0;
      const perc = +(sorted.filter(s => s <= nota).length / sorted.length * 100).toFixed(1);
      return [i + 1, a.nome || '', a.turma || '', +nota.toFixed(2), faixa, zscore, perc];
    });
    [rankHeader, ...rankRows].forEach((rowData, ri) => {
      const row = ws2.getRow(ri + 1);
      rowData.forEach((val, ci) => {
        const c = row.getCell(ci + 1);
        c.value = val;
        c.font = { bold: ri === 0 || (ri > 0 && (ci === 0 || ci === 3)), size: 11, name: 'Arial', color: { argb: ri === 0 ? _REL_XL.headerFont : 'FF1A1A1A' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri === 0 ? _REL_XL.headerBg : _REL_XL.green } };
        c.alignment = { vertical: 'middle', horizontal: ci === 0 || ci === 3 ? 'center' : 'left' };
        c.border = _REL_XL.thinBorder;
      });
    });
    ws2.columns = [{ width: 10 }, { width: 38 }, { width: 16 }, { width: 11 }, { width: 20 }, { width: 11 }, { width: 14 }];

    // ── Análise por questão ──
    const allResps = alunos.map(a => (a.resps || '').split(''));
    const qHeader = ['Nº Questão', 'Grande Área', 'Tema', 'Gabarito', 'Anulada', '% Acerto', 'Dificuldade', 'Resp A (%)', 'Resp B (%)', 'Resp C (%)', 'Resp D (%)', 'Resp E (%)', 'Branco/Inválido (%)'];
    const qRows = questions.map((q, i) => {
      const respsQ = allResps.map(r => r[i] || '-');
      const anulada = q.anulada === true;
      const n = respsQ.length || 1;
      const countA = respsQ.filter(r => r === 'A').length;
      const countB = respsQ.filter(r => r === 'B').length;
      const countC = respsQ.filter(r => r === 'C').length;
      const countD = respsQ.filter(r => r === 'D').length;
      const countE = respsQ.filter(r => r === 'E').length;
      const countOther = respsQ.filter(r => !['A','B','C','D','E'].includes(r)).length;
      const acertos = q.gab ? respsQ.filter(r => r === q.gab).length : 0;
      const pctNum = anulada ? null : (acertos / n * 100);
      const pctAcertoDisp = pctNum == null ? '—' : +pctNum.toFixed(2);
      const dif = pctNum == null ? '—' : pctNum >= 70 ? 'Fácil' : pctNum >= 40 ? 'Médio' : 'Difícil';
      return {
        cells: [
          q.q != null ? q.q : i + 1, q.area || '—', q.tema || '—', q.gab || '—', anulada ? 'Sim' : 'Não',
          pctAcertoDisp, dif,
          +(countA/n*100).toFixed(2), +(countB/n*100).toFixed(2), +(countC/n*100).toFixed(2),
          +(countD/n*100).toFixed(2), +(countE/n*100).toFixed(2), +(countOther/n*100).toFixed(2)
        ],
        pctNum
      };
    });
    const ws3 = wb.addWorksheet('Análise por Questão');
    const qAll = [qHeader, ...qRows.map(x => x.cells)];
    qAll.forEach((rowData, ri) => {
      const row = ws3.getRow(ri + 1);
      const stripe = ri > 0 && (ri - 1) % 2 === 0 ? _REL_XL.stripeA : _REL_XL.stripeB;
      rowData.forEach((val, ci) => {
        const c = row.getCell(ci + 1);
        c.value = val;
        c.font = { bold: ri === 0 || (ri > 0 && ci === 5), size: 10, name: 'Arial', color: { argb: ri === 0 ? _REL_XL.headerFont : 'FF1A1A1A' } };
        let bg = ri === 0 ? _REL_XL.headerBg : stripe;
        if (ri > 0 && ci === 5 && qRows[ri - 1].pctNum != null) {
          const pct = qRows[ri - 1].pctNum;
          bg = pct >= 60 ? _REL_XL.green : pct >= 40 ? _REL_XL.yellow : _REL_XL.red;
        }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.alignment = { vertical: 'middle', wrapText: true, horizontal: ci >= 6 ? 'center' : 'left' };
        c.border = _REL_XL.thinBorder;
      });
    });
    ws3.columns = [{ width: 12 }, { width: 28 }, { width: 36 }, { width: 10 }, { width: 9 }, { width: 11 }, { width: 12 },
      { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 16 }];

    // ── Desempenho por área ──
    const areaHeader = ['Grande Área', 'Nº Questões', 'Média IES (%)', 'Acima de 60%', 'Abaixo de 40%', 'Desvio Padrão (%)'];
    const areaRowsRaw = areaStats.map(a => {
      const qsArea = questions.filter(q => q.area === a.label);
      const nQ = qsArea.length;
      const indices = qsArea.map(q => questions.indexOf(q));
      const notasArea = alunos.map(al => {
        const respsAl = (al.resps || '').split('');
        const hits = indices.filter(ii => respsAl[ii] === questions[ii]?.gab).length;
        return nQ > 0 ? hits / nQ * 100 : 0;
      });
      const mediaA = notasArea.reduce((s, v) => s + v, 0) / (notasArea.length || 1);
      const stdA = Math.sqrt(notasArea.reduce((s, v) => s + (v - mediaA) ** 2, 0) / (notasArea.length || 1));
      const ac60 = notasArea.filter(v => v >= 60).length;
      const ab40 = notasArea.filter(v => v < 40).length;
      return [a.label, nQ, +mediaA.toFixed(2), ac60, ab40, +stdA.toFixed(2)];
    }).sort((a, b) => b[2] - a[2]);
    const ws4 = wb.addWorksheet('Desempenho por Área');
    [areaHeader, ...areaRowsRaw].forEach((rowData, ri) => {
      const row = ws4.getRow(ri + 1);
      let rowBg = _REL_XL.headerBg;
      if (ri > 0) {
        const rank = ri - 1;
        const n = areaRowsRaw.length;
        rowBg = rank === 0 ? _REL_XL.green : rank <= Math.max(1, Math.ceil(n / 3)) ? _REL_XL.yellow : _REL_XL.red;
      }
      rowData.forEach((val, ci) => {
        const c = row.getCell(ci + 1);
        c.value = val;
        c.font = { bold: true, size: 11, name: 'Arial', color: { argb: ri === 0 ? _REL_XL.headerFont : 'FF1A1A1A' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        c.alignment = { vertical: 'middle', horizontal: ci >= 1 ? 'center' : 'left' };
        c.border = _REL_XL.thinBorder;
      });
    });
    ws4.columns = [{ width: 30 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 18 }];

    // ── Distribuição ──
    const faixasLabels = ['0–9%','10–19%','20–29%','30–39%','40–49%','50–59%','60–69%','70–79%','80–89%','90–100%'];
    const distHeader = ['Faixa de Nota', 'Nº Alunos', '% da Turma', 'Proficiência'];
    const distRows = faixasLabels.map((f, i) => ({
      cells: [f, bins[i], +(bins[i] / totalAlunos * 100).toFixed(2), i >= 6 ? 'Proficiente' : i >= 5 ? 'Limítrofe' : 'Abaixo'],
      idx: i
    }));
    distRows.push({ cells: ['TOTAL', totalAlunos, 100, ''], idx: -1 });
    const ws5 = wb.addWorksheet('Distribuição de Notas');
    [distHeader, ...distRows.map(d => d.cells)].forEach((rowData, ri) => {
      const row = ws5.getRow(ri + 1);
      const isTotalRow = ri === 11;
      rowData.forEach((val, ci) => {
        const c = row.getCell(ci + 1);
        c.value = val;
        const boldProf = ri >= 1 && ri <= 10 && ci === 3;
        c.font = { bold: ri === 0 || isTotalRow || boldProf, size: 11, name: 'Arial', color: { argb: ri === 0 ? _REL_XL.headerFont : 'FF1A1A1A' } };
        let bg = _REL_XL.headerBg;
        if (ri > 0 && ri <= 10) {
          const idxFaixa = distRows[ri - 1].idx;
          if (idxFaixa < 5) bg = _REL_XL.red;
          else if (idxFaixa === 5) bg = _REL_XL.yellow;
          else if (idxFaixa <= 9) bg = _REL_XL.green;
        } else if (isTotalRow) bg = 'FFE8E8E8';
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.alignment = { vertical: 'middle', horizontal: ci >= 1 && ci <= 2 ? 'center' : 'left' };
        c.border = _REL_XL.thinBorder;
      });
    });
    ws5.columns = [{ width: 14 }, { width: 12 }, { width: 14 }, { width: 14 }];

    // ── Matriz ──
    const matrixHeader = ['Nome', 'Turma', 'Nota (%)', ...questions.map((q, i) => 'Q' + (q.q != null ? q.q : i + 1))];
    const gabRow = ['GABARITO', '', '', ...questions.map(q => q.gab || '—')];
    const matrixRows = alunosSorted.map(a => {
      const respsAl = (a.resps || '').split('');
      return [a.nome || '', a.turma || '', +(a.nota || 0).toFixed(2), ...questions.map((q, i) => {
        const r = respsAl[i] || '-';
        if (q.anulada) return '*';
        return r;
      })];
    });
    const ws6 = wb.addWorksheet('Matriz de Respostas');
    [matrixHeader, gabRow, ...matrixRows].forEach((rowData, ri) => {
      const row = ws6.getRow(ri + 1);
      rowData.forEach((val, ci) => {
        const c = row.getCell(ci + 1);
        c.value = val;
        if (ri === 0) {
          c.font = { bold: true, size: 10, name: 'Arial', color: { argb: _REL_XL.headerFont } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: _REL_XL.headerBg } };
        } else if (ri === 1) {
          c.font = { bold: true, size: 10, name: 'Arial', color: { argb: _REL_XL.accentFont } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: _REL_XL.accentSection } };
        } else {
          const q = questions[ci - 3];
          let bg = _REL_XL.nameCol;
          if (ci >= 3 && q) {
            const resp = String(val);
            if (q.anulada) bg = _REL_XL.stripeB;
            else if (resp === (q.gab || '')) bg = _REL_XL.green;
            else bg = _REL_XL.red;
          }
          c.font = { bold: ci === 2, size: 10, name: 'Arial' };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        }
        c.alignment = { vertical: 'middle', horizontal: ci >= 3 ? 'center' : 'left' };
        c.border = _REL_XL.thinBorder;
      });
    });
    ws6.columns = [{ width: 36 }, { width: 14 }, { width: 10 }, ...questions.map(() => ({ width: 6 }))];

    // ── Pivot áreas ──
    const areaNames = areaStats.map(a => a.label);
    const pivotHeader = ['Nome', 'Turma', 'Nota Total (%)', ...areaNames];
    const pivotRows = alunosSorted.map(a => {
      const areaCols = areaNames.map(ar => +(a.areas?.[ar] ?? 0).toFixed(2));
      return [a.nome || '', a.turma || '', +(a.nota || 0).toFixed(2), ...areaCols];
    });
    const ws7 = wb.addWorksheet('Alunos × Áreas');
    [pivotHeader, ...pivotRows].forEach((rowData, ri) => {
      const row = ws7.getRow(ri + 1);
      rowData.forEach((val, ci) => {
        const c = row.getCell(ci + 1);
        c.value = val;
        if (ri === 0) {
          c.font = { bold: true, size: 10, name: 'Arial', color: { argb: _REL_XL.headerFont } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: _REL_XL.headerBg } };
        } else {
          let bg = _REL_XL.nameCol;
          if (ci >= 3) {
            const v = Number(val);
            bg = v >= 60 ? _REL_XL.green : v >= 40 ? _REL_XL.yellow : _REL_XL.red;
          }
          c.font = { bold: ci === 2, size: 10, name: 'Arial' };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        }
        c.alignment = { vertical: 'middle', horizontal: ci >= 2 ? 'center' : 'left' };
        c.border = _REL_XL.thinBorder;
      });
    });
    ws7.columns = [{ width: 36 }, { width: 14 }, { width: 14 }, ...areaNames.map(() => ({ width: 18 }))];

    const xlsxName = (baseName || 'Relatorio') + '.xlsx';
    const buf = await wb.xlsx.writeBuffer();
    if (returnBlob) {
      return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = xlsxName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
})();
