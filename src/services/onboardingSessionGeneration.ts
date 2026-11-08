// Shared by the auth owner and onboarding requests; no React or browser globals.
// Each request captures this auth epoch when issued. Identity changes and
// successful /me verification (including the same account) advance it, so a
// delayed 401 cannot undo a newer confirmation.
let generation = 0;

export const currentOnboardingSessionGeneration = () => generation;
export const advanceOnboardingSessionGeneration = () => ++generation;
