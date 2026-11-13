#!/bin/sh
# One-time setup ON the Raspberry Pi. Creates a "diet" user that can only deploy Diet Mentor (separate from the Bill Split "deploy" user).
#
#   sudo sh pi-setup-deploy.sh diet_deploy.pub
#
# After this, from your PC:  ssh diet-pi status   /   scripts/deploy.ps1
set -eu

PUBKEY_FILE=${1:?usage: sudo sh pi-setup-deploy.sh <public-key-file>}
DEPLOY_USER=diet
DEPLOY_HOME=/home/$DEPLOY_USER
APP_DIR=$DEPLOY_HOME/diet-mentor

[ "$(id -u)" -eq 0 ] || { echo "Τρέξε το με sudo" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Το Docker δεν είναι εγκατεστημένο" >&2; exit 1; }
grep -q '^ssh-ed25519 ' "$PUBKEY_FILE" || { echo "Δεν είναι ed25519 public key: $PUBKEY_FILE" >&2; exit 1; }

rand_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# 1. user without password, allowed to use docker
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

# 2. the ONLY command the deploy key is allowed to run
cat > /usr/local/bin/diet-remote <<'REMOTE'
#!/bin/sh
# Forced SSH command for the Diet Mentor deploy key.
# Allowed: deploy (tar.gz of the repo on stdin) | status | logs [db|api|web|tunnel] | restart | backup | restore (SQL on stdin)
set -eu
set -f
APP_DIR="$HOME/diet-mentor"
COMPOSE="docker compose -p diet-mentor"

set -- ${SSH_ORIGINAL_COMMAND:-}
case "${1:-}" in
  deploy)
    [ -f "$APP_DIR/.env" ] || { echo "Λείπει το $APP_DIR/.env" >&2; exit 1; }
    NEW=$(mktemp -d "$HOME/.deploy.XXXXXX")
    trap 'rm -rf "$NEW"' EXIT
    tar -xzf - -C "$NEW"
    [ -f "$NEW/docker-compose.yml" ] || { echo "Το upload δεν μοιάζει με το diet-mentor" >&2; exit 1; }
    cp "$APP_DIR/.env" "$NEW/.env"
    rm -rf "$APP_DIR.prev"
    mv "$APP_DIR" "$APP_DIR.prev"
    mv "$NEW" "$APP_DIR"
    trap - EXIT
    cd "$APP_DIR"
    echo ">> building and starting containers"
    $COMPOSE up -d --build --remove-orphans
    docker image prune -f >/dev/null
    $COMPOSE ps
    ;;
  status)
    cd "$APP_DIR" && $COMPOSE ps
    ;;
  logs)
    case "${2:-}" in ""|db|api|web|tunnel) ;; *) echo "Άγνωστο service: $2" >&2; exit 1 ;; esac
    cd "$APP_DIR" && $COMPOSE logs --tail=200 ${2:-}
    ;;
  restart)
    cd "$APP_DIR" && $COMPOSE restart
    ;;
  backup)
    # the whole database as SQL on stdout:  ssh diet-pi backup > diet.sql
    cd "$APP_DIR" && $COMPOSE exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"'
    ;;
  restore)
    # a data-only dump on stdin, into a database that has no accounts yet (see scripts/migrate-to-pi.ps1)
    cd "$APP_DIR"
    USERS=$($COMPOSE exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM users"' < /dev/null)
    [ "$USERS" = "0" ] || { echo "Η βάση έχει ήδη $USERS λογαριασμούς: δεν γίνεται restore από πάνω" >&2; exit 1; }
    $COMPOSE exec -T db sh -c 'psql -v ON_ERROR_STOP=1 --single-transaction -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
    echo "Λογαριασμοί μετά το restore: $($COMPOSE exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM users"' < /dev/null)"
    ;;
  *)
    echo "Επιτρέπονται μόνο: deploy | status | logs [db|api|web|tunnel] | restart | backup | restore" >&2
    exit 1
    ;;
esac
REMOTE
chmod 755 /usr/local/bin/diet-remote

# 3. SSH key restricted to that command (no shell, no forwarding)
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
printf 'restrict,command="/usr/local/bin/diet-remote" %s\n' "$(head -n 1 "$PUBKEY_FILE")" \
  > "$DEPLOY_HOME/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh/authorized_keys"
chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"

# 4. app folder + .env (kept across deploys)
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
if [ ! -f "$APP_DIR/.env" ]; then
  OLD_ENV="/home/${SUDO_USER:-none}/diet-mentor/.env"
  if [ -f "$OLD_ENV" ]; then
    cp "$OLD_ENV" "$APP_DIR/.env"
    echo ">> αντιγράφηκε το υπάρχον .env από $OLD_ENV"
  else
    # An existing database keeps the password it was created with.
    if docker volume inspect diet-mentor_pgdata >/dev/null 2>&1; then DB_PASS=diet; else DB_PASS=$(rand_hex 16); fi
    cat > "$APP_DIR/.env" <<ENV
WEB_PORT=8082
APP_URL=http://$(hostname).local:8082
JWT_SECRET=$(rand_hex 32)
POSTGRES_USER=diet
POSTGRES_PASSWORD=$DB_PASS
POSTGRES_DB=diet
ENV
    echo ">> δημιουργήθηκε νέο .env"
  fi
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

echo ""
echo "OK. Ο χρήστης '$DEPLOY_USER' είναι έτοιμος. Δοκίμασε από τον υπολογιστή σου:  ssh diet-pi status"
