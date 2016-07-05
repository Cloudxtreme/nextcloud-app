FROM cloudron/base:0.8.1
MAINTAINER Johannes Zellner <johannes@cloudron.io>

EXPOSE 8000

RUN mkdir -p /app/code
WORKDIR /app/code

# get nextcloud source
RUN cd /tmp && \
    wget https://download.nextcloud.com/server/releases/nextcloud-9.0.52.zip && \
    unzip nextcloud-9.0.52.zip && \
    mv /tmp/nextcloud/* /app/code/ && \
    rm -rf /tmp/nextcloud/ nextcloud-9.0.52.zip

# create config folder link to make the config survive updates
RUN rm -rf /app/code/config && \
    ln -s /app/data/config /app/code/config && \
    mv /app/code/apps /app/apps_template && \
    ln -s /app/data/apps /app/code/apps

# configure apache
RUN rm /etc/apache2/sites-enabled/*
RUN sed -e 's,^ErrorLog.*,ErrorLog "|/bin/cat",' -i /etc/apache2/apache2.conf
RUN sed -e "s,MaxSpareServers[^:].*,MaxSpareServers 5," -i /etc/apache2/mods-available/mpm_prefork.conf

RUN a2disconf other-vhosts-access-log
ADD apache2-nextcloud.conf /etc/apache2/sites-available/nextcloud.conf
RUN ln -sf /etc/apache2/sites-available/nextcloud.conf /etc/apache2/sites-enabled/nextcloud.conf
RUN echo "Listen 8000" > /etc/apache2/ports.conf

# configure mod_php
RUN a2enmod php5
RUN sed -e 's/upload_max_filesize = .*/upload_max_filesize = 80M/' \
        -e 's,;session.save_path.*,session.save_path = "/run/nextcloud/sessions",' \
        -i /etc/php5/apache2/php.ini
RUN mkdir -p /run/nextcloud/sessions

RUN chown -R www-data.www-data /app/code /run/nextcloud

ADD start.sh cron.sh /app/

CMD [ "/app/start.sh" ]
