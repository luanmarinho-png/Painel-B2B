/**
 * Lê CPFs (um por linha, só dígitos) de um arquivo e lista quais existem em alunos_master.
 * Uso: node scripts/query-cpfs-in-alunos-master.js caminho/para/cpfs.txt
 */
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  const raw = fs.readFileSync(p, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[k] = v;
  }
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node scripts/query-cpfs-in-alunos-master.js <arquivo-cpfs.txt>');
    process.exit(1);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const list = raw
    .split(/\s+/)
    .map((s) => s.replace(/\D/g, ''))
    .filter((s) => s.length === 11);
  if (!list.length) {
    console.error('Nenhum CPF de 11 dígitos encontrado.');
    process.exit(1);
  }

  loadEnv();
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGO_DATABASE || 'medcof_b2b';
  if (!uri) throw new Error('MONGODB_URI missing');

  /** Normaliza cpf no servidor sem $function (Atlas M0/M2 etc. bloqueiam server-side JS). */
  const digitsOnly = {
    $replaceAll: {
      input: {
        $replaceAll: {
          input: { $toString: { $ifNull: ['$cpf', ''] } },
          find: '.',
          replacement: ''
        }
      },
      find: '-',
      replacement: ''
    }
  };

  const pipeline = [
    {
      $match: {
        $expr: {
          $in: [digitsOnly, list]
        }
      }
    },
    { $project: { _id: 0, cpf: 1, nome: 1, instituicao: 1 } }
  ];

  (async () => {
    const client = new MongoClient(uri);
    await client.connect();
    const coll = client.db(dbName).collection('alunos_master');
    const rows = await coll.aggregate(pipeline).toArray();
    const foundDigits = new Set(rows.map((r) => String(r.cpf || '').replace(/\D/g, '')));
    const inMaster = list.filter((c) => foundDigits.has(c));
    const notIn = list.filter((c) => !foundDigits.has(c));

    console.log('TOTAL_LISTA', list.length);
    console.log('JA_EM_ALUNOS_MASTER', inMaster.length);
    console.log('CPFS_ENCONTRADOS');
    console.log(inMaster.join('\n'));
    console.log('---');
    console.log('NAO_ENCONTRADOS', notIn.length);
    console.log(notIn.join('\n'));
    await client.close();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
