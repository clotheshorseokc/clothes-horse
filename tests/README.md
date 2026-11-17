# Tests

Run against the local Firebase emulators (needs Java). Nothing here touches the real project.

    cd tests && npm install
    npm run test:rules   # database rules: who can read and change what
    npm run test:e2e     # the app in a browser: owner setup, offline checkout, save retries, staff approval, manager sign-in, PINs
