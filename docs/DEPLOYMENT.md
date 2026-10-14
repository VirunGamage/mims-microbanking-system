# Putting MIMS on a cloud server

This puts the same Docker setup that runs on a laptop (`docker compose up`) on a small Linux server in the cloud, so
the app has a public HTTPS address that the team and the examiners can open from anywhere, and the daily interest
job can really run every night. It takes about 45 minutes the first time.

What runs on the server:

| Container | What it does |
|---|---|
| `web` (Caddy) | The only way in from the internet (ports 80 and 443). Gets a free HTTPS certificate and passes requests to the app |
| `app` | The Node.js API and the React pages, exactly as in `docker compose up`: the start page with the sign-in |
| `db` | MySQL 8.0.46 with the MIMS database. Not reachable from the internet at all |

`docker-compose.cloud.yml` adds these server settings on top of `docker-compose.yml`, so the laptop setup is unchanged.

> **Only sample data goes on this server.** Customers, agents and admins sign in on the start page, and the demo
> accounts (README, *Sign in and online banking*) are shown there for the examiners, so anyone who finds the address can
> try them. For an extra lock in front of the whole site, set `APP_USERNAME` / `APP_PASSWORD` (step 6). Delete the
> server after grading (step 10).

## 1. Get Azure for Students

Sign up at **https://azure.microsoft.com/free/students** with your university e-mail address. It gives free credit
(no credit card) that is more than enough for this server for the rest of the semester. Any other cloud works the same
way (see *Other cloud providers* at the end).

## 2. Create the server

In the Azure portal (https://portal.azure.com) search for **Virtual machines**, then **Create** -> **Azure virtual
machine**, and fill in:

**Basics** tab:

| Setting | Value |
|---|---|
| Resource group | Create new: `mims-rg` |
| Virtual machine name | `mims-server` |
| Region | **(Asia Pacific) Malaysia West**. Azure for Students only allows a few regions (Malaysia West, East Asia, Korea Central, Indonesia Central, South Africa North); the portal refuses the others |
| Availability options | No infrastructure redundancy required |
| Security type | Standard |
| Image | **Ubuntu Server 24.04 LTS - x64 Gen2** |
| Size | **Standard_B2als_v2** (2 vCPUs, 4 GiB, about US$31 a month while running). If it is not offered, the cheapest size with at least 2 GiB: MySQL needs the memory |
| Run with Azure Spot discount | Leave it **off**: Azure can switch a Spot server off at any moment, even during the demo |
| Authentication type | **SSH public key** |
| Username | `azureuser` |
| SSH public key source | Generate new key pair, RSA SSH Format, name `mims-server_key` |
| Public inbound ports | Allow selected ports: **SSH (22), HTTP (80), HTTPS (443)** |

**Disks** tab: OS disk type **Standard SSD**. **Networking** tab: tick **Delete public IP and NIC when VM is deleted**.
**Management** tab: tick **Enable auto-shutdown**, at `11:00:00 PM`, time zone **(UTC+05:30) Sri Jayawardenepura**, so
the server switches itself off every night even if nobody remembers to stop it.

Click **Review + create**, then **Create**. Azure offers the private key for download: click **Download private key and
create resource** and keep the file `mims-server_key.pem` safe (it is the only way to log in to the server).

## 3. Give the server a web address

When the server is ready, open it, and on its **Overview** page click the **DNS name** (it says *Not configured*). Type a
**DNS name label** such as `btrust-mims` and click **Save**. The server's address is now shown, something like:

```
btrust-mims.malaysiawest.cloudapp.azure.com
```

Write it down: it is your `PUBLIC_ADDRESS`, and the address you will open in the browser.

## 4. Connect to the server from Windows

Move `mims-server_key.pem` into the folder `C:\Users\<your name>\.ssh` (create the `.ssh` folder if it is not there).
SSH refuses a key file that other users can read, so in **Command Prompt** (not PowerShell, which does not understand
`%USERPROFILE%`) run these two lines once, from any folder:

```
icacls "%USERPROFILE%\.ssh\mims-server_key.pem" /inheritance:r
icacls "%USERPROFILE%\.ssh\mims-server_key.pem" /grant:r "%USERNAME%":R
```

Then connect (use your own address from step 3):

```
ssh -i "%USERPROFILE%\.ssh\mims-server_key.pem" azureuser@btrust-mims.malaysiawest.cloudapp.azure.com
```

Type `yes` the first time. You are now typing commands on the server (the prompt shows `azureuser@mims-server`).
Every command in steps 5 to 7 is typed there.

## 5. Install Docker on the server

```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker azureuser
exit
```

Connect again (the same `ssh` line as in step 4), then check that Docker works (it must show a **Client** and a
**Server** section):

```
docker version
```

## 6. Get MIMS and fill in its settings

```
git clone https://github.com/VirunGamage/mims-microbanking-system.git
cd mims-microbanking-system
cp cloud.env.example .env
nano .env
```

`nano` is a simple text editor. Fill in every empty value:

| Setting | What to put |
|---|---|
| `PUBLIC_ADDRESS` | The address from step 3, without `https://` |
| `SESSION_SECRET` | Long random text that signs the sign-in cookies, for example the output of `openssl rand -hex 32` |
| `APP_USERNAME` / `APP_PASSWORD` | Optional extra lock: the browser asks for these before the start page (password at least 8 characters). Leave both empty to open the start page directly |
| `MYSQL_ROOT_PASSWORD` / `APP_DB_PASSWORD` | Two different new passwords for the database, at least 8 characters each |
| `MIMS_DAILY_INTEREST` | `off` while auto-shutdown is on (the server is switched off at 03:00 anyway), and use the Run interest button. `on` lets a server that runs day and night post interest by itself every day at 03:00 (Sri Lanka time) |
| `SMTP_...` / `MAIL_...` | Optional, for e-mail notifications (README, *Email notifications*) |

Use letters, digits, `-` and `_` in the passwords. Save with **Ctrl + O**, **Enter**, and leave with **Ctrl + X**.

## 7. Start MIMS

```
docker compose -f docker-compose.yml -f docker-compose.cloud.yml up -d --build
```

The first start takes a few minutes (it builds the images and loads the sample data). Check that all three containers
are up and healthy:

```
docker compose -f docker-compose.yml -f docker-compose.cloud.yml ps
```

Now open **https://\<your PUBLIC_ADDRESS\>** in a browser. It asks for the username and password from `.env`, then shows
MIMS. The padlock in the address bar is the HTTPS certificate Caddy fetched by itself.

## 8. Automatic updates after every merge (CD)

`.github/workflows/deploy.yml` updates the server whenever a change merged into `main` has passed CI. It needs three
secrets in GitHub: open the repository on GitHub -> **Settings** -> **Secrets and variables** -> **Actions** ->
**New repository secret**, and add:

| Name | Value |
|---|---|
| `DEPLOY_HOST` | The address from step 3 |
| `DEPLOY_USER` | `azureuser` |
| `DEPLOY_SSH_KEY` | The whole contents of `mims-server_key.pem` (open it in Notepad and copy everything, including the BEGIN and END lines) |

From then on: pull request -> CI green -> merge -> the **Deploy** workflow in the **Actions** tab runs, and a minute or
two later the server shows the new version. It can also be started by hand there (**Run workflow**). The server must be
running for this (auto-shutdown stops it every night): if it was stopped, start it and click **Run workflow**.

## 9. Everyday commands (on the server, in `~/mims-microbanking-system`)

To save typing, set this once per login: `alias mims='docker compose -f docker-compose.yml -f docker-compose.cloud.yml'`

| To | Run |
|---|---|
| See if everything is up | `mims ps` |
| Read the app's log (Ctrl + C to stop) | `mims logs -f app` |
| Update by hand to the newest `main` | `git pull && mims up -d --build` |
| Run the SQL tests on the server (reloads the sample data) | `mims exec db mims-tests` |
| Start again with fresh sample data | `mims down -v && mims up -d` |
| Switch the daily interest on later | `mims exec db sh -c 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot -e "ALTER EVENT mims.ev_daily_interest ENABLE"'` |

## 10. Saving credit and cleaning up

- **Stop** the server in the Azure portal when nobody needs it (the virtual machine's **Stop** button); a stopped
  server costs almost nothing (only its public IP address, about US$3.60 a month). **Start** it again before the demo;
  MIMS starts by itself a minute later. The data and the address stay the same.
- **After grading, delete everything**: in the portal open **Resource groups** -> `mims-rg` -> **Delete resource group**.

## If something goes wrong

| Problem | What to check |
|---|---|
| The page does not load at all | In the portal: the server is **Running**, and **Networking** allows inbound ports 80 and 443 |
| A certificate or "not secure" error | `PUBLIC_ADDRESS` in `.env` must be exactly the address from step 3; after fixing it: `mims up -d`. See `mims logs web` |
| `502 Bad Gateway` | The app is still starting (up to a minute after a start or an update); `mims ps` shows it as healthy when it is ready |
| The browser's login box keeps coming back | `APP_USERNAME` / `APP_PASSWORD` do not match `.env` exactly (or leave both empty) |
| Signed out after every update | Set `SESSION_SECRET` in `.env` (step 6), then `mims up -d` |
| Pages say an error after an update that changed `.sql` files | The database still has the old procedures: `mims down -v && mims up -d --build` (reloads the sample data) |
| `required variable ... is missing a value` | A setting in `.env` is empty; fill it in (step 6) |
| The Deploy workflow fails | The server was stopped (start it and run the workflow again), or check the three secrets (step 8) and that `ssh` from step 4 still works |
| `ssh` says `UNPROTECTED PRIVATE KEY FILE` | Run the two `icacls` lines from step 4 again |

## Other cloud providers

Any Linux server with Docker works: AWS EC2, Google Cloud, DigitalOcean (free credit through the GitHub Student
Developer Pack) or Oracle Cloud. Open ports 22, 80 and 443, give the server a DNS name if the provider offers one, and
follow steps 5 to 9 unchanged. Without a DNS name, set `PUBLIC_ADDRESS=:80` and open `http://<server IP>`; that works,
but without HTTPS the login travels unencrypted, so use it only for a quick test.
