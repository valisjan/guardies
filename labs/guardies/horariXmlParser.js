// Parser de domini sense dependències de Vue, Firebase ni de l'estat de la interfície.
// DOMParser s'avalua només en invocar els parsers XML, per facilitar-ne la reutilització.
  const DIA_LABELS = {
    '1': 'Dilluns',
    '2': 'Dimarts',
    '3': 'Dimecres',
    '4': 'Dijous',
    '5': 'Divendres',
    '6': 'Dissabte',
    '7': 'Diumenge',
  };

  const HORES_UNTIS_PER_DEFECTE = ['8:00', '8:55', '9:50', '11:15', '12:10', '13:05', '14:15'];

  function atribut(node, nom) {
    return (node && node.getAttribute && node.getAttribute(nom)) || '';
  }

  function textNet(text) {
    return (text || '').toString().replace(/^\uFEFF/, '').trim();
  }

  function normalitzarClau(valor) {
    return textNet(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function addIndex(index, clau, item) {
    const normal = normalitzarClau(clau);
    if (!normal) return;
    if (!index.has(normal)) index.set(normal, []);
    if (!index.get(normal).includes(item)) index.get(normal).push(item);
  }

  function primerIndex(index, clau) {
    return index?.get(normalitzarClau(clau))?.[0] || null;
  }

  function paraulesNormalitzades(valor) {
    return textNet(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function aliasesAula(descripcio) {
    const normal = normalitzarClau(descripcio);
    const paraules = paraulesNormalitzades(descripcio);
    const aliases = [normal];
    if (normal.startsWith('aula')) aliases.push(`aul${normal.slice(4)}`);
    if (paraules.length > 1) {
      aliases.push(`${paraules[0].slice(0, 3)}${paraules.slice(1).map((part) => part[0]).join('')}`);
    } else {
      const numerada = normal.match(/^([a-z]+)(\d.*)$/);
      if (numerada) aliases.push(`${numerada[1].slice(0, 3)}${numerada[2]}`);
    }
    aliases.push(normal.replace(/(.)\1+/g, '$1'));
    return Array.from(new Set(aliases.filter(Boolean)));
  }

  function aulaPerPrefixUnic(index, clau) {
    const normal = normalitzarClau(clau);
    if (normal.length < 6) return null;
    const candidats = new Map();
    index?.forEach((items, alias) => {
      if (!alias.startsWith(normal)) return;
      items.forEach((item) => candidats.set(item.codi, item));
    });
    return candidats.size === 1 ? Array.from(candidats.values())[0] : null;
  }

  function parseCsvLine(line) {
    const values = [];
    let current = '';
    let quoted = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current);
    return values.map((value) => value.trim());
  }

  function nomProfessor(cognoms, nom, codi) {
    const parts = [];
    if (cognoms) parts.push(cognoms);
    if (nom) parts.push(nom);
    return parts.length ? parts.join(', ') : codi;
  }

  function semblaNom(valor) {
    const text = textNet(valor);
    return /[a-zA-ZÀ-ÿ]/.test(text);
  }

  function addProfessorUntis(professorat, professor) {
    if (!professor?.codi) return;
    professorat.professors.set(professor.codi, professor);
    [
      professor.codi,
      professor.cognoms,
      professor.nom,
      professor.label,
      `${professor.cognoms || ''} ${professor.nom || ''}`,
    ].forEach((alias) => addIndex(professorat.professorsIndex, alias, professor));
  }

  function parseProfessoratUntisTxt(text) {
    const professorat = {
      professors: new Map(),
      professorsIndex: new Map(),
      source: 'txt',
    };

    textNet(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const fields = parseCsvLine(line);
        const codi = fields[0] || '';
        if (!codi) return;
        const cognoms = fields[1] || '';
        addProfessorUntis(professorat, {
          codi,
          cognoms,
          nom: '',
          label: cognoms || codi,
        });
      });

    return professorat;
  }

  function attrFirst(node, names) {
    return names.map((name) => atribut(node, name)).find(Boolean) || '';
  }

  function parseProfessoratUntisXml(text) {
    const xml = parseXmlRobust(text);
    const professorat = {
      professors: new Map(),
      professorsIndex: new Map(),
      source: 'xml',
    };

    Array.from(xml.getElementsByTagName('*')).forEach((node) => {
      const tag = (node.localName || node.nodeName || '').toUpperCase();
      if (!/(PROF|TEACH|PLACA|PERSON|PERSONA)/.test(tag)) return;

      const codi = attrFirst(node, [
        'curta',
        'codi',
        'code',
        'id',
        'short',
        'abbr',
        'abbrev',
        'abbreviation',
        'abreviatura',
      ]);
      if (!codi) return;

      const cognoms = attrFirst(node, [
        'cognoms',
        'llinatges',
        'apellidos',
        'surname',
        'lastName',
        'lastname',
      ]);
      const nom = attrFirst(node, [
        'nom',
        'nombre',
        'name',
        'firstName',
        'firstname',
        'forename',
      ]);
      const descripcio = attrFirst(node, [
        'descripcio',
        'descripcion',
        'description',
        'fullName',
        'fullname',
      ]);
      const label = descripcio || nomProfessor(cognoms, nom, codi);

      if (label === codi && !cognoms && !nom && !descripcio) return;
      addProfessorUntis(professorat, { codi, cognoms: cognoms || descripcio, nom, label });
    });

    return professorat;
  }

  function parseUntisProfessorat(text) {
    const net = textNet(text);
    if (!net) {
      return { professors: new Map(), professorsIndex: new Map(), source: '' };
    }

    if (net.startsWith('<')) return parseProfessoratUntisXml(net);
    return parseProfessoratUntisTxt(net);
  }

  function codisGuardiaUntis(gpu002Text) {
    const codis = new Set(['G', 'GP', 'GC', 'GCONV']);
    textNet(gpu002Text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const fields = parseCsvLine(line);
        const codi = fields[6] || '';
        const label = normalitzarClau(fields[20] || '');
        if (codi && label.startsWith('gua')) codis.add(codi);
      });
    return codis;
  }

  function placaPerCodiProfessor(referencia, codiProfessor) {
    if (!referencia?.places || !codiProfessor) return codiProfessor;
    const normal = normalitzarClau(codiProfessor);
    for (const [placa, info] of referencia.places.entries()) {
      if (normalitzarClau(info.curta) === normal) return placa;
    }
    return codiProfessor;
  }

  function parseUntisGuardies(gpu001Text, { gpu002Text = '', referencia = null, professoratUntis = null, hores = [] } = {}) {
    const guardCodes = codisGuardiaUntis(gpu002Text);
    const sessions = [];

    textNet(gpu001Text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        const fields = parseCsvLine(line);
        const codiProfessor = fields[2] || '';
        const activitat = fields[3] || '';
        const dia = fields[5] || '';
        const horaIndex = Number(fields[6]) || 0;
        if (!codiProfessor || codiProfessor === '?' || !guardCodes.has(activitat) || !dia || !horaIndex) return;

        const placa = placaPerCodiProfessor(referencia, codiProfessor);
        const professor = resoldreProfessorUntis(professoratUntis, codiProfessor);
        const hora = hores[horaIndex - 1] || String(horaIndex);
        const esConvivencia = activitat === 'GC' || activitat === 'GCONV';
        const sessio = {
          index: `gpu001-${index}`,
          origenGuardia: 'GPU001',
          placa,
          curs: '',
          grup: '',
          dia,
          hora,
          durada: 0,
          aula: fields[4] || '',
          materia: '',
          activitat,
          key: '',
          franja: franjaKey(dia, hora),
          diaLabel: diaLabel(dia),
          teClasse: false,
          teActivitat: true,
          tipus: 'activitat',
          professorCurta: professor?.codi || codiProfessor,
          professorNom: professor?.label || '',
          grupVisible: '',
          cursVisible: '',
          materiaCurta: '',
          materiaNom: '',
          activitatCurta: activitat === 'GP'
            ? 'Guàrdia pati'
            : esConvivencia
              ? 'Guàrdia de convivència'
              : 'Guàrdia',
          activitatNom: activitat,
          activitatEsGuardia: true,
          activitatEsGuardiaGeneral: activitat !== 'GP' && !esConvivencia,
          aulaNom: '',
        };
        sessio.key = sessioKey(sessio);
        sessions.push(sessio);
      });

    return sessions.sort(ordenarSessions);
  }

  function parseUntisHorari(gpu001Text, {
    gpu002Text = '',
    referencia = null,
    professoratUntis = null,
    hores = HORES_UNTIS_PER_DEFECTE,
  } = {}) {
    const guardCodes = codisGuardiaUntis(gpu002Text);
    const sessions = [];

    textNet(gpu001Text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        const fields = parseCsvLine(line);
        const grupUntis = fields[1] || '';
        const codiProfessor = fields[2] || '';
        const codiMateriaActivitat = fields[3] || '';
        const aulaUntis = fields[4] || '';
        const dia = fields[5] || '';
        const horaIndex = Number(fields[6]) || 0;
        if (!codiProfessor || codiProfessor === '?' || !dia || !horaIndex) return;

        const grup = resoldreGrup(referencia, grupUntis, '');
        const materia = grupUntis ? resoldreMateria(referencia, codiMateriaActivitat) : null;
        const activitat = !grupUntis ? resoldreActivitat(referencia, codiMateriaActivitat) : null;
        const aula = resoldreAula(referencia, aulaUntis);
        const placa = placaPerCodiProfessor(referencia, codiProfessor);
        const professor = resoldreProfessorUntis(professoratUntis, codiProfessor);
        const hora = hores[horaIndex - 1] || String(horaIndex);
        const esGuardia = guardCodes.has(codiMateriaActivitat);
        const esConvivencia = codiMateriaActivitat === 'GC' || codiMateriaActivitat === 'GCONV';
        const teClasse = Boolean(grupUntis);
        const teActivitat = !teClasse && Boolean(codiMateriaActivitat);

        const sessio = {
          index: `gpu001-${index}`,
          origenGuardia: esGuardia ? 'GPU001' : '',
          placa,
          curs: grup?.curs || '',
          grup: grup?.codi || grupUntis,
          dia,
          hora,
          durada: 0,
          aula: aula?.codi || aulaUntis,
          materia: teClasse ? (materia?.codi || codiMateriaActivitat) : '',
          activitat: teActivitat ? codiMateriaActivitat : '',
          franja: franjaKey(dia, hora),
          diaLabel: diaLabel(dia),
          teClasse,
          teActivitat,
          tipus: teActivitat ? 'activitat' : teClasse ? 'classe' : 'altres',
          professorCurta: professor?.codi || codiProfessor,
          professorNom: professor?.label || '',
          grupVisible: grup?.visible || grupUntis,
          cursVisible: grup?.cursVisible || '',
          materiaCurta: materia?.curta || (teClasse ? codiMateriaActivitat : ''),
          materiaNom: materia?.descripcio || '',
          activitatCurta: activitat?.curta || (teActivitat ? codiMateriaActivitat : ''),
          activitatNom: activitat?.descripcio || '',
          activitatEsGuardia: esGuardia,
          activitatEsGuardiaGeneral: esGuardia && codiMateriaActivitat !== 'GP' && !esConvivencia,
          aulaNom: aula?.descripcio || aulaUntis,
        };
        sessio.key = sessioKey(sessio);

        const enriquida = enriquirSessio(sessio, referencia, professoratUntis);
        sessions.push({
          ...enriquida,
          origenGuardia: sessio.origenGuardia,
          professorCurta: enriquida.professorCurta || sessio.professorCurta,
          professorNom: enriquida.professorNom || sessio.professorNom,
          grupVisible: enriquida.grupVisible || sessio.grupVisible,
          cursVisible: enriquida.cursVisible || sessio.cursVisible,
          materiaCurta: enriquida.materiaCurta || sessio.materiaCurta,
          materiaNom: enriquida.materiaNom || sessio.materiaNom,
          activitatCurta: enriquida.activitatCurta || sessio.activitatCurta,
          activitatNom: enriquida.activitatNom || sessio.activitatNom,
          activitatEsGuardia: sessio.activitatEsGuardia || enriquida.activitatEsGuardia,
          activitatEsGuardiaGeneral: sessio.activitatEsGuardiaGeneral || enriquida.activitatEsGuardiaGeneral,
          aulaNom: enriquida.aulaNom || sessio.aulaNom,
        });
      });

    if (!sessions.length) {
      throw new Error('No s\'han trobat sessions dins del GPU001.');
    }

    const ordenades = sessions.sort(ordenarSessions);
    return {
      format: 'untis-gpu001',
      sessions: ordenades,
      resum: resumSessions(ordenades),
      defaultGuardiaCodes: Array.from(new Set(
        ordenades.filter((session) => session.activitatEsGuardiaGeneral).map((session) => session.activitat),
      )),
    };
  }

  function parseXmlRobust(text) {
    const parser = new DOMParser();
    const net = textNet(text);
    let xml = parser.parseFromString(net, 'application/xml');
    let error = xml.querySelector('parsererror');

    if (error) {
      const escapades = net.replace(
        /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[a-fA-F0-9]+;)/g,
        '&amp;'
      );
      xml = parser.parseFromString(escapades, 'application/xml');
      error = xml.querySelector('parsererror');
    }

    if (error) {
      const detall = (error.textContent || '').replace(/\s+/g, ' ').slice(0, 180);
      throw new Error(`No s'ha pogut llegir l'XML. ${detall}`);
    }

    return xml;
  }

  function nodesPerTag(node, tag) {
    const directes = Array.from(node.getElementsByTagName(tag));
    if (directes.length) return directes;
    return Array.from(node.getElementsByTagName('*')).filter(
      (el) => (el.localName || el.nodeName || '').toUpperCase() === tag
    );
  }

  function diaLabel(dia) {
    return DIA_LABELS[dia] || `Dia ${dia || '?'}`;
  }

  function franjaKey(dia, hora) {
    return `${dia || ''}|${hora || ''}`;
  }

  function sessioKey(sessio) {
    return [
      sessio.index,
      sessio.placa,
      sessio.dia,
      sessio.hora,
      sessio.curs,
      sessio.grup,
      sessio.materia,
      sessio.activitat,
      sessio.aula,
    ].join('|');
  }

  function normalitzarSessio(node, index) {
    const sessio = {
      index,
      placa: atribut(node, 'placa'),
      curs: atribut(node, 'curs'),
      grup: atribut(node, 'grup'),
      dia: atribut(node, 'dia'),
      hora: atribut(node, 'hora'),
      durada: Number(atribut(node, 'durada')) || 0,
      aula: atribut(node, 'aula'),
      materia: atribut(node, 'materia'),
      activitat: atribut(node, 'activitat'),
    };

    sessio.key = sessioKey(sessio);
    sessio.franja = franjaKey(sessio.dia, sessio.hora);
    sessio.diaLabel = diaLabel(sessio.dia);
    sessio.teClasse = Boolean(sessio.curs || sessio.grup || sessio.materia);
    sessio.teActivitat = Boolean(sessio.activitat);
    sessio.tipus = sessio.teActivitat && !sessio.teClasse
      ? 'activitat'
      : sessio.teClasse
      ? 'classe'
      : 'altres';

    return sessio;
  }

  function codiCursVisible(descripcio) {
    const text = (descripcio || '').toString().trim();
    const compacte = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const eso = text.match(/^([1-4])r?\s*ESO$/i) || text.match(/^([1-4])n\s*ESO$/i);
    if (eso) return `${eso[1]}ESO`;
    const batx = text.match(/^([12])(?:r|n)?\s*Batx/i);
    if (batx) return `${batx[1]}BAT`;
    const batxCurt = compacte.match(/^([12])B$/);
    if (batxCurt) return `${batxCurt[1]}BAT`;
    const esoCurt = compacte.match(/^([1-4])E$/);
    if (esoCurt) return `${esoCurt[1]}ESO`;
    return text.replace(/\s+/g, '');
  }

  function codiCursUntis(visible) {
    const text = (visible || '').toString().toUpperCase();
    const batx = text.match(/^([12])BAT$/);
    if (batx) return batx[1] === '2' ? '2b' : `${batx[1]}B`;
    return text;
  }

  function netejarAsterisc(text) {
    return (text || '').toString().replace(/^\s*\*/, '').trim();
  }

  function codiActivitatUntis(curta, descripcio, usats) {
    const base = normalitzarClau(netejarAsterisc(curta) || netejarAsterisc(descripcio) || 'ACT')
      .toUpperCase()
      .slice(0, 14) || 'ACT';
    const prefix = /^\s*\*/.test(curta || '') || /^\s*\*/.test(descripcio || '') ? 'A' : '';
    const baseFinal = `${prefix}${base}`.slice(0, 14) || 'ACT';
    let codi = baseFinal;
    let index = 2;
    while (usats.has(codi)) {
      const sufix = String(index);
      codi = `${baseFinal.slice(0, Math.max(1, 14 - sufix.length))}${sufix}`;
      index += 1;
    }
    usats.add(codi);
    return codi;
  }

  function parseGestibReference(text) {
    const xml = parseXmlRobust(text);
    const root = xml.documentElement;
    const rootName = (root && (root.localName || root.nodeName) || '').toUpperCase();
    if (rootName !== 'CENTRE') {
      throw new Error(`El XML de referència ha de tenir arrel CENTRE. Arrel detectada: ${rootName || 'desconeguda'}.`);
    }

    const cursos = new Map();
    const cursosIndex = new Map();
    const grups = new Map();
    const grupsIndex = new Map();
    nodesPerTag(xml, 'CURS').forEach((node) => {
      const codi = atribut(node, 'codi');
      const descripcio = atribut(node, 'descripcio');
      const visible = codiCursVisible(descripcio);
      const curs = { codi, descripcio, visible, untis: codiCursUntis(visible) };
      if (codi) cursos.set(codi, curs);
      [codi, descripcio, visible, curs.untis].forEach((alias) => addIndex(cursosIndex, alias, curs));
      nodesPerTag(node, 'GRUP').forEach((grupNode) => {
        const grupCodi = atribut(grupNode, 'codi');
        const nom = atribut(grupNode, 'nom');
        if (grupCodi) {
          const grup = {
            codi: grupCodi,
            nom,
            curs: codi,
            cursVisible: visible,
            visible: visible && nom ? `${visible}-${nom}` : nom || grupCodi,
          };
          grups.set(grupCodi, grup);
          [
            grupCodi,
            nom,
            grup.visible,
            visible && nom ? `${visible}${nom}` : '',
            curs.untis && nom ? `${curs.untis}-${nom}` : '',
            curs.untis && nom ? `${curs.untis}${nom}` : '',
          ].forEach((alias) => addIndex(grupsIndex, alias, grup));
        }
      });
    });

    const places = new Map();
    const placesIndex = new Map();
    nodesPerTag(xml, 'PLACA').forEach((node) => {
      const codi = atribut(node, 'codi');
      if (!codi) return;
      const placa = {
        codi,
        curta: atribut(node, 'curta'),
        descripcio: atribut(node, 'descripcio'),
      };
      places.set(codi, placa);
      [placa.codi, placa.curta, placa.descripcio].forEach((alias) => addIndex(placesIndex, alias, placa));
    });

    const materies = new Map();
    const materiesIndex = new Map();
    nodesPerTag(xml, 'MATERIA').forEach((node) => {
      const codi = atribut(node, 'codi');
      if (!codi) return;
      const materia = {
        codi,
        curs: atribut(node, 'curs'),
        descripcio: atribut(node, 'descripcio'),
        curta: atribut(node, 'curta'),
      };
      materies.set(codi, materia);
      [materia.codi, materia.curta, materia.descripcio].forEach((alias) => addIndex(materiesIndex, alias, materia));
    });

    const activitats = new Map();
    const activitatsIndex = new Map();
    const codisActivitatUsats = new Set();
    nodesPerTag(xml, 'ACTIVITAT').forEach((node) => {
      const codi = atribut(node, 'codi');
      if (!codi) return;
      const descripcio = atribut(node, 'descripcio');
      const curta = atribut(node, 'curta');
      const text = `${netejarAsterisc(descripcio)} ${netejarAsterisc(curta)}`.toLowerCase();
      const codiUntis = codiActivitatUntis(curta, descripcio, codisActivitatUsats);
      const activitat = {
        codi,
        codiUntis,
        descripcio,
        curta,
        label: curta || descripcio || codi,
        esGuardia: text.includes('guàrdia') || text.includes('guardia'),
        esGuardiaGeneral:
          (text.includes('guàrdia') || text.includes('guardia')) &&
          !text.includes('pati') &&
          !text.includes('biblioteca'),
      };
      activitats.set(codi, activitat);
      [
        activitat.codi,
        activitat.codiUntis,
        activitat.curta,
        activitat.descripcio,
        netejarAsterisc(activitat.curta),
        netejarAsterisc(activitat.descripcio),
      ].forEach((alias) => addIndex(activitatsIndex, alias, activitat));
    });

    const aules = new Map();
    const aulesIndex = new Map();
    nodesPerTag(xml, 'AULA').forEach((node) => {
      const codi = atribut(node, 'codi');
      if (!codi) return;
      const aula = {
        codi,
        descripcio: atribut(node, 'descripcio'),
      };
      aules.set(codi, aula);
      [aula.codi, ...aliasesAula(aula.descripcio)].forEach((alias) => addIndex(aulesIndex, alias, aula));
    });

    return {
      centre: atribut(root, 'codi'),
      any: atribut(root, 'any'),
      cursos,
      cursosIndex,
      grups,
      grupsIndex,
      places,
      placesIndex,
      materies,
      materiesIndex,
      activitats,
      activitatsIndex,
      aules,
      aulesIndex,
    };
  }

  function resoldreCurs(referencia, codi) {
    if (!referencia || !codi) return null;
    return referencia.cursos?.get(codi) || primerIndex(referencia.cursosIndex, codi);
  }

  function resoldreGrup(referencia, codi, cursCodi) {
    if (!referencia || !codi) return null;
    const directe = referencia.grups?.get(codi);
    if (directe) return directe;

    const candidats = referencia.grupsIndex?.get(normalitzarClau(codi)) || [];
    if (candidats.length <= 1) return candidats[0] || null;

    const curs = resoldreCurs(referencia, cursCodi);
    if (!curs) return candidats[0];
    return candidats.find((grup) => grup.curs === curs.codi) || candidats[0];
  }

  function resoldreMateria(referencia, codi) {
    if (!referencia || !codi) return null;
    return referencia.materies?.get(codi) || primerIndex(referencia.materiesIndex, codi);
  }

  function resoldreActivitat(referencia, codi) {
    if (!referencia || !codi) return null;
    return referencia.activitats?.get(codi) || primerIndex(referencia.activitatsIndex, codi);
  }

  function resoldreAula(referencia, codi) {
    if (!referencia || !codi) return null;
    return referencia.aules?.get(codi)
      || primerIndex(referencia.aulesIndex, codi)
      || aulaPerPrefixUnic(referencia.aulesIndex, codi);
  }

  function resoldrePlaca(referencia, codi) {
    if (!referencia || !codi) return null;
    return referencia.places?.get(codi) || primerIndex(referencia.placesIndex, codi);
  }

  function resoldreProfessorUntis(professoratUntis, codi) {
    if (!professoratUntis || !codi) return null;
    return professoratUntis.professors?.get(codi) || primerIndex(professoratUntis.professorsIndex, codi);
  }

  function enriquirSessio(sessio, referencia, professoratUntis = null) {
    const placa = resoldrePlaca(referencia, sessio.placa);
    const professor = resoldreProfessorUntis(
      professoratUntis,
      placa?.curta || placa?.descripcio || sessio.placa
    ) || resoldreProfessorUntis(professoratUntis, sessio.placa);
    const curs = resoldreCurs(referencia, sessio.curs);
    const grup = resoldreGrup(referencia, sessio.grup, sessio.curs);
    const materia = resoldreMateria(referencia, sessio.materia);
    const activitat = resoldreActivitat(referencia, sessio.activitat);
    const aula = resoldreAula(referencia, sessio.aula);
    return {
      ...sessio,
      professorCurta: professor?.codi || placa?.curta || sessio.professorCurta || '',
      professorNom: professor?.label || placa?.descripcio || '',
      grupVisible: grup?.visible || sessio.grupVisible || '',
      cursVisible: grup?.cursVisible || curs?.visible || '',
      materiaCurta: materia?.curta || sessio.materiaCurta || '',
      materiaNom: materia?.descripcio || '',
      activitatCurta: activitat?.curta || sessio.activitatCurta || '',
      activitatNom: activitat?.descripcio || '',
      activitatEsGuardia: Boolean(activitat?.esGuardia),
      activitatEsGuardiaGeneral: Boolean(activitat?.esGuardiaGeneral),
      aulaNom: aula?.descripcio || '',
    };
  }

  function uniq(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function comptar(values) {
    const map = new Map();
    values.filter(Boolean).forEach((value) => map.set(value, (map.get(value) || 0) + 1));
    return Array.from(map.entries())
      .map(([valor, count]) => ({ valor, count }))
      .sort((a, b) => String(a.valor).localeCompare(String(b.valor), 'ca', { numeric: true }));
  }

  function ordenarPerDiaHora(a, b) {
    const dia = Number(a.dia) - Number(b.dia);
    if (dia) return dia;
    return (a.hora || '').localeCompare(b.hora || '', 'ca', { numeric: true });
  }

  function ordenarSessions(a, b) {
    const franja = ordenarPerDiaHora(a, b);
    if (franja) return franja;
    return (a.placa || '').localeCompare(b.placa || '', 'ca', { numeric: true });
  }

  function resumSessions(sessions) {
    const dies = uniq(sessions.map((s) => s.dia)).sort((a, b) => Number(a) - Number(b));
    const hores = uniq(sessions.map((s) => s.hora)).sort((a, b) => a.localeCompare(b, 'ca', { numeric: true }));
    const franges = [];

    dies.forEach((dia) => {
      hores.forEach((hora) => {
        const total = sessions.filter((s) => s.dia === dia && s.hora === hora).length;
        if (total) franges.push({ key: franjaKey(dia, hora), dia, hora, diaLabel: diaLabel(dia), total });
      });
    });

    return {
      sessions: sessions.length,
      professors: uniq(sessions.map((s) => s.placa)).length,
      grups: uniq(sessions.map((s) => s.grup)).length,
      cursos: uniq(sessions.map((s) => s.curs)).length,
      materies: uniq(sessions.map((s) => s.materia)).length,
      activitats: comptar(sessions.map((s) => s.activitat)),
      dies,
      hores,
      franges,
    };
  }

  function parseHorariXml(text, referencia = null, professoratUntis = null) {
    const xml = parseXmlRobust(text);
    const root = xml.documentElement;
    const rootName = (root && (root.localName || root.nodeName) || '').toUpperCase();
    if (rootName !== 'HORARI') {
      throw new Error(`Arrel XML no esperada: ${rootName || 'desconeguda'}. S'esperava HORARI.`);
    }

    const sessions = nodesPerTag(xml, 'SESSIO')
      .map(normalitzarSessio)
      .map((sessio) => enriquirSessio(sessio, referencia, professoratUntis))
      .sort(ordenarSessions);

    if (!sessions.length) {
      throw new Error('No s\'han trobat sessions dins del XML.');
    }

    return {
      format: 'xml',
      sessions,
      resum: resumSessions(sessions),
      defaultGuardiaCodes: sessions.some((s) => s.activitatEsGuardiaGeneral)
        ? [...new Set(sessions.filter((s) => s.activitatEsGuardiaGeneral).map((s) => s.activitat))]
        : [],
    };
  }

  function sessionsDeFranja(sessions, dia, hora) {
    return sessions.filter((s) => s.dia === dia && s.hora === hora);
  }

  function professorsOrdenats(sessions) {
    return uniq(sessions.map((s) => s.placa))
      .sort((a, b) => String(a).localeCompare(String(b), 'ca', { numeric: true }))
      .map((placa) => ({ placa, label: `Placa ${placa}` }));
  }

  function agruparSessionsCobertura(sessions) {
    const map = new Map();
    sessions.forEach((sessio) => {
      const key = [
        sessio.placa,
        sessio.dia,
        sessio.hora,
        sessio.materia,
        sessio.aula,
        sessio.activitat,
      ].join('|');

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          placa: sessio.placa,
          dia: sessio.dia,
          diaLabel: sessio.diaLabel,
          hora: sessio.hora,
          materia: sessio.materia,
          materiaCurta: sessio.materiaCurta || '',
          materiaNom: sessio.materiaNom || '',
          aula: sessio.aula,
          aulaNom: sessio.aulaNom || '',
          activitat: sessio.activitat,
          activitatCurta: sessio.activitatCurta || '',
          activitatNom: sessio.activitatNom || '',
          cursos: new Set(),
          cursosVisibles: new Set(),
          grups: new Set(),
          grupsVisibles: new Set(),
          sessions: [],
        });
      }

      const grup = map.get(key);
      if (sessio.curs) grup.cursos.add(sessio.curs);
      if (sessio.cursVisible) grup.cursosVisibles.add(sessio.cursVisible);
      if (sessio.grup) grup.grups.add(sessio.grup);
      if (sessio.grupVisible) grup.grupsVisibles.add(sessio.grupVisible);
      grup.sessions.push(sessio);
    });

    return Array.from(map.values()).map((item) => ({
      ...item,
      cursos: Array.from(item.cursos).sort((a, b) => a.localeCompare(b, 'ca', { numeric: true })),
      cursosVisibles: Array.from(item.cursosVisibles).sort((a, b) => a.localeCompare(b, 'ca', { numeric: true })),
      grups: Array.from(item.grups).sort((a, b) => a.localeCompare(b, 'ca', { numeric: true })),
      grupsVisibles: Array.from(item.grupsVisibles).sort((a, b) => a.localeCompare(b, 'ca', { numeric: true })),
    }));
  }

  function ocupacioFranja(sessions, dia, hora, guardiaCodes) {
    const guardies = new Set(Array.from(guardiaCodes || []).filter(Boolean));
    const perProfessor = new Map();
    professorsOrdenats(sessions).forEach((prof) => {
      perProfessor.set(prof.placa, {
        placa: prof.placa,
        label: prof.label,
        sessions: [],
        classes: [],
        guardies: [],
        activitats: [],
        lliure: true,
      });
    });

    sessionsDeFranja(sessions, dia, hora).forEach((sessio) => {
      if (!sessio.teClasse && !sessio.teActivitat) return;
      if (!perProfessor.has(sessio.placa)) return;
      const item = perProfessor.get(sessio.placa);
      item.sessions.push(sessio);
      item.lliure = false;
      if (sessio.teClasse) item.classes.push(sessio);
      if (sessio.activitatEsGuardiaGeneral || (sessio.activitat && guardies.has(sessio.activitat))) item.guardies.push(sessio);
      else if (sessio.teActivitat) item.activitats.push(sessio);
    });

    return Array.from(perProfessor.values());
  }

  const HorariXmlParser = {
    DIA_LABELS,
    diaLabel,
    franjaKey,
    parseHorariXml,
    parseUntisHorari,
    parseGestibReference,
    parseUntisProfessorat,
    parseUntisGuardies,
    sessionsDeFranja,
    professorsOrdenats,
    agruparSessionsCobertura,
    ocupacioFranja,
  };

export {
  DIA_LABELS,
  HorariXmlParser,
  agruparSessionsCobertura,
  diaLabel,
  franjaKey,
  ocupacioFranja,
  parseGestibReference,
  parseHorariXml,
  parseUntisHorari,
  parseUntisGuardies,
  parseUntisProfessorat,
  professorsOrdenats,
  sessionsDeFranja,
};
