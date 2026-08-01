const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

export function isValidEmail(email) {
    return Boolean(email && EMAIL_REGEX.test(email));
}
