// controllers/ubigeo.controller.js
// Catálogo de Departamento -> Provincia -> Distrito (datos oficiales
// INEI 2016). Se usa para armar direcciones por Ubigeo en vez de texto
// libre, en Personas y Propietarios, tal como pidió el ingeniero.
const { sql, getPool } = require('../config/db');

// GET /api/ubigeo/departamentos
async function listarDepartamentos(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      'SELECT CodigoDepartamento, Nombre FROM Departamentos ORDER BY Nombre'
    );
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar departamentos.' });
  }
}

// GET /api/ubigeo/provincias/:codigoDepartamento
async function listarProvincias(req, res) {
  try {
    const { codigoDepartamento } = req.params;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('codigoDepartamento', sql.Char(2), codigoDepartamento)
      .query(
        'SELECT CodigoProvincia, Nombre FROM Provincias WHERE CodigoDepartamento = @codigoDepartamento ORDER BY Nombre'
      );
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar provincias.' });
  }
}

// GET /api/ubigeo/distritos/:codigoProvincia
async function listarDistritos(req, res) {
  try {
    const { codigoProvincia } = req.params;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('codigoProvincia', sql.Char(4), codigoProvincia)
      .query(
        'SELECT CodigoDistrito, Nombre FROM Distritos WHERE CodigoProvincia = @codigoProvincia ORDER BY Nombre'
      );
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar distritos.' });
  }
}

module.exports = { listarDepartamentos, listarProvincias, listarDistritos };
