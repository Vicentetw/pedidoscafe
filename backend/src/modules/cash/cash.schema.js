const { z } = require('zod');

const money = z.coerce.number().nonnegative().max(1e8).multipleOf(0.01);

const createRegister = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/, 'Sólo minúsculas, números, guión y guión bajo.'),
  name: z.string().trim().min(2).max(80),
});

const openRegister = z.object({ openingAmount: money.default(0) });
const closeSession = z.object({ closingAmount: money });
const addMovement = z.object({
  type: z.enum(['PAYOUT', 'DEPOSIT', 'ADJUST']), // SALE/REFUND los genera el sistema, no se cargan a mano
  amount: z.coerce.number().max(1e8).multipleOf(0.01), // ADJUST puede ser negativo
  reason: z.string().trim().min(2).max(300),
});

module.exports = { createRegister, openRegister, closeSession, addMovement };
