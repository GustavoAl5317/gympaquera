function assertAdult(nascimento) {
    const d = new Date(String(nascimento) + 'T12:00:00');
    if (Number.isNaN(d.getTime())) throw new Error('Data de nascimento inválida.');
    const today = new Date();
    let age = today.getFullYear() - d.getFullYear();
    const m = today.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
    if (age < 18) throw new Error('Cadastro permitido apenas para maiores de 18 anos.');
}

function ageFromNascimento(nascimento) {
    if (!nascimento) return null;
    const d = new Date(String(nascimento) + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - d.getFullYear();
    const m = today.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
    return age;
}

module.exports = { assertAdult, ageFromNascimento };
