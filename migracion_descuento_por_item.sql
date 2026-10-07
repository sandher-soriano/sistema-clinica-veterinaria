-- migracion_descuento_por_item.sql
-- Descuentos por producto en Caja: cada ítem guarda su descuento manual y la
-- parte de la promoción que le tocó (así se sabe cuánto se rebajó en cada cosa).
USE PremierCanDB;
GO
IF COL_LENGTH('dbo.PagosDetalle', 'Descuento') IS NULL
    ALTER TABLE dbo.PagosDetalle ADD Descuento DECIMAL(10,2) NOT NULL CONSTRAINT DF_PDet_Descuento DEFAULT 0
        CONSTRAINT CK_PDet_Descuento CHECK (Descuento >= 0);
IF COL_LENGTH('dbo.PagosDetalle', 'DescuentoPromo') IS NULL
    ALTER TABLE dbo.PagosDetalle ADD DescuentoPromo DECIMAL(10,2) NOT NULL CONSTRAINT DF_PDet_DescPromo DEFAULT 0
        CONSTRAINT CK_PDet_DescPromo CHECK (DescuentoPromo >= 0);
GO
