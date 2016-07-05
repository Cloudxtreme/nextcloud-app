#!/bin/bash

set -eux

export mail_from_sub=$(echo $MAIL_FROM | cut -d \@ -f 1)
export mail_domain_sub=$(echo $MAIL_FROM | cut -d \@ -f 2)

rewrite_config() {
    # merge runtime config with existing config
    sudo -u www-data --preserve-env php <<'EOF'
<?php
    require_once "/app/code/config/config.php";
    $db = parse_url(getenv('POSTGRESQL_URL'));
    $runtime_config = array (
        'trusted_domains' =>
          array (
            0 => getenv('APP_DOMAIN'),
          ),
        'forcessl' => getenv('CLOUDRON'), # if unset/false, nextcloud sends a HSTS=0 header
        'mail_smtpmode' => 'smtp',
        'mail_smtpauth' => 'login',
        'mail_smtphost' => getenv('MAIL_SMTP_SERVER'),
        'mail_smtpport' => getenv('MAIL_SMTP_PORT'),
        'mail_smtpname' => getenv('MAIL_SMTP_USERNAME'),
        'mail_smtppassword' => getenv('MAIL_SMTP_PASSWORD'),
        'mail_from_address' => getenv('mail_from_sub'),
        'mail_domain' => getenv('mail_domain_sub'),
        'overwrite.cli.url' => getenv('APP_ORIGIN'),
        'dbtype' => 'pgsql',
        'dbname' => substr($db['path'], 1),
        'dbuser' => $db['user'],
        'dbpassword' => $db['pass'],
        'dbhost' => $db['host'],
        'updatechecker' => false,
        'lost_password_link' => getenv('WEBADMIN_ORIGIN').'/api/v1/session/password/resetRequest.html',
        'logfile' => '/tmp/nextcloud.log', # default log is in data directory
        'loglevel' => '3 '# set to 0 for debugging
    );

    $CONFIG = array_replace($CONFIG, $runtime_config);
    file_put_contents("/app/code/config/config.php", "<?php\n\$CONFIG = " . var_export($CONFIG, true) . ";\n");
EOF
}

setupAndConfigure() {
    while [[ ! -f "/run/apache2/apache2.pid" ]]; do
        echo "Waiting for apache2 to start"
        sleep 1
    done

    if [[ -z "$(ls -A /app/data)" ]]; then
        echo "Detected first run"
        sudo -u www-data bash -c 'mkdir -p /app/data/config'
        sudo -u www-data bash -c 'cp -rf /app/apps_template /app/data/apps'

        echo "Installing database"
        sudo -u www-data php /app/code/occ  maintenance:install --data-dir "/app/data" --database "pgsql" --database-host "${POSTGRESQL_HOST}:${POSTGRESQL_PORT}" --database-name "${POSTGRESQL_DATABASE}"  --database-user "${POSTGRESQL_USERNAME}" --database-pass "${POSTGRESQL_PASSWORD}" --admin-user "admin" --admin-pass "changeme"
    else
        NEW_APPS="/app/apps_template"
        OLD_APPS="/app/data/apps"

        echo "===== Updating apps ====="

        echo "Old apps:"
        ls "${NEW_APPS}/"
        ls "${OLD_APPS}/"

        for app in `find "${NEW_APPS}"/* -maxdepth 0 -type d -printf "%f\n"`; do
            echo "Update app: ${app}"
            rm -rf "${OLD_APPS}/${app}"
            cp -rf "${NEW_APPS}/${app}" "${OLD_APPS}"
        done

        echo "New apps:"
        ls "${NEW_APPS}/"
        ls "${OLD_APPS}/"
    fi

    if [[ ! -f /app/data/config/config.php ]]; then
        echo "Something went wrong, config.php does not exist"
        exit 1
    fi

    rewrite_config

    sudo -u www-data php /app/code/occ upgrade || true # does nothing if not installed

    # enable ldap
    sudo -u www-data php /app/code/occ app:enable user_ldap || true

    # configure ldap
    # the first argument is the first config id, which is an empty string!
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_host --value "ldap://${LDAP_SERVER}"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_port --value "${LDAP_PORT}"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_base --value "${LDAP_USERS_BASE_DN}"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_base_users --value "${LDAP_USERS_BASE_DN}"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_base_groups --value "${LDAP_GROUPS_BASE_DN}"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_expert_uuid_user_attr --value "uid"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_email_attr --value "mail"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_loginfilter_email --value "1"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_loginfilter_username --value "1"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_userfilter_objectclass --value "user"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_configuration_active --value "1"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_display_name --value "displayname"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_userlist_filter --value "(|(objectclass=user))"
    sudo -u www-data php /app/code/occ config:app:set user_ldap ldap_login_filter --value "(&(objectclass=user)(|(username=%uid)(mail=%uid)))"

    # now disable maintenance mode in case it was set
    sudo -u www-data php /app/code/occ maintenance:mode --off
}

chown -R www-data.www-data /app/data # any restored data as well

( setupAndConfigure ) &

APACHE_CONFDIR="" source /etc/apache2/envvars
rm -f "${APACHE_PID_FILE}"
exec /usr/sbin/apache2 -DFOREGROUND

