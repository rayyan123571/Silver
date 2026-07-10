# Gold Lab licence generator

A standalone Node CLI that signs offline licences with an Ed25519 **private** key.

It is **not part of the application**. It lives outside `electron/`, so
`electron-builder` never packages it (`build.files` ships only `dist/`,
`electron/` and `package.json`), and no application file imports it. It has no
dependencies beyond Node's built-in `crypto` and `fs`.

## One-time key setup

Do this **once, offline, on a machine that does not build the app**:

```sh
openssl genpkey -algorithm ed25519 -out license_private.pem
openssl pkey -in license_private.pem -pubout -out license_public.pem
```

Paste the contents of `license_public.pem` into `LICENSE_PUBLIC_KEY` in
`electron/license/licenseManager.cjs`.

Keep `license_private.pem` off every developer machine, out of git, and out of the
installer. If it leaks, anyone can mint licences and the scheme is finished — you
would have to ship a new public key and re-issue every licence.

## Issuing a licence

The customer reads their Machine ID off the trial-expired window (`Copy Machine
ID`) and sends it to you.

```sh
# perpetual
node generate-license.cjs --key license_private.pem \
  --machine-id GL-8A7F91CD22EF --name "Chaudhry Gold Lab" --lifetime

# time-limited, written to a file
node generate-license.cjs --key license_private.pem \
  --machine-id GL-8A7F91CD22EF --name "Some Shop" \
  --expiry 2027-01-01 --out license.dat
```

Output is the licence JSON and nothing else — stdout carries only JSON, so it can
be piped or redirected. Progress messages and errors go to stderr.

```json
{
  "machineId": "GL-8A7F91CD22EF",
  "customerName": "Chaudhry Gold Lab",
  "expiry": null,
  "signature": "<base64 Ed25519>"
}
```

`expiry: null` means perpetual. The signature covers `machineId`, `customerName`
and `expiry` — nothing else.

## Keeping the format in sync

`canonicalPayload()` is duplicated here and in
`electron/license/licenseManager.cjs`, deliberately: the generator must not depend
on the app, and the app must never depend on the generator. **If you change one,
change the other.** The generator self-checks each signature against the public
half of the key you passed, which catches a broken payload — but only a real
verification inside the app catches a format drift between the two files.
