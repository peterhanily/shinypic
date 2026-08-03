# Secure Cloudflare Pages deployment

The official ShinyPic demo is a static Cloudflare Pages **Direct Upload**
project. There is no custom domain, Pages Function, Worker, environment
variable, storage binding, application analytics, or runtime secret.

Direct Upload was chosen deliberately: Cloudflare's GitHub App does not need
access to the repository, and a maintainer can inspect and build the exact
commit being deployed. The trade-off is permanent for this Pages project:
Cloudflare does not let a Direct Upload project switch to built-in Git
integration later. A new Pages project would be required. See Cloudflare's
[Direct Upload documentation](https://developers.cloudflare.com/pages/get-started/direct-upload/)
before copying this choice.

## Maintainer workstation

Use a maintained Node.js release (20 or newer) and Wrangler 4.95.0 or newer.
Authenticate with browser OAuth; never put a global API key, OAuth token,
account ID, `.env`, or Wrangler state in this repository.

```sh
wrangler login
wrangler whoami
```

The relevant local paths are already ignored: `.wrangler/`, `.dev.vars*`,
`.env*`, credential/key formats, and package-manager state. Authentication is
still sensitive workstation state; protect the GitHub and Cloudflare accounts
with phishing-resistant MFA and review active sessions regularly.

## Create the project once

```sh
wrangler pages project create shinypic --production-branch main
```

No custom domain is needed. If the name is available, the production URL is
`https://shinypic.pages.dev/`.

## Release a reviewed commit

The worktree should be clean and `HEAD` should be the exact public commit.

```sh
git status --short
npm test
npm run build
git rev-parse HEAD
wrangler pages deploy dist \
  --project-name shinypic \
  --branch main \
  --commit-hash YOUR_REVIEWED_COMMIT_SHA \
  --commit-dirty=false
```

`dist/_headers` is produced from the committed `_headers` file. It sets the
content security, permissions, referrer, framing, MIME, and cross-origin
policies and prevents search indexing of preview deployments. Do not add inline
scripts, remote fonts, third-party runtime assets, or network APIs without
updating and reviewing that policy.

## Verify production

After each deployment:

```sh
wrangler pages deployment list --project-name shinypic --environment production
curl --fail --head https://shinypic.pages.dev/
curl --fail --head https://shinypic.pages.dev/app.js
```

Then use a clean browser profile to check:

1. all four local demo assets load;
2. a synthetic JPEG upload produces no unexpected network request;
3. Magic, Tap, and Paint work with pointer, touch, and keyboard input at desktop
   and mobile widths;
4. HDR and SDR files download and native share has a safe fallback;
5. the HDR JPEG identifies as `Rec. ITU-R BT.2100 PQ` in an independent tool;
6. CaddyLabs and GitHub links point to the intended HTTPS origins; and
7. the CSP and other headers are present on production responses.

Keep the previous known-good deployment available until these checks finish.
Cloudflare's Pages dashboard can roll production back to an earlier deployment.

## Optional CI deployment

The default repository CI intentionally has no deployment permission or secret.
If unattended deployment becomes necessary, create a custom Cloudflare API
token limited to this account and **Account → Cloudflare Pages → Edit**, give it
the shortest operationally practical lifetime, and store only these GitHub
Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Never use the Global API Key. Keep deployment out of pull-request workflows,
pin every action to a reviewed full commit SHA, use a protected production
environment, and attach the source commit SHA to the Pages deployment. Follow
Cloudflare's [Direct Upload CI
guide](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
and [token restriction
guidance](https://developers.cloudflare.com/fundamentals/api/how-to/restrict-tokens/).

## Git-integrated alternative

For forks that prefer automatic branch previews, create a *new* Git-integrated
Pages project and restrict the Cloudflare Workers & Pages GitHub App to that one
repository. Cloudflare documents the access control in its [GitHub integration
guide](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/).
Use:

- production branch: `main`
- build command: `npm test && npm run build`
- output directory: `dist`
- environment variables: none
- Functions and bindings: none

Do not install the GitHub App across every personal or organization repository
when one-repository access is sufficient.
