export function validatePassword(password: string) {
  if (password.length < 8) {
    return "Use at least 8 characters.";
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Include an uppercase letter, a lowercase letter, and a number.";
  }

  return undefined;
}
