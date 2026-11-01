"""
SGP4 worker scaffold: fetch GP/OMM from CelesTrak, cache, propagate SGP4, publish pass context to MQTT
"""
import os
import time
import logging
import requests
import json
from sgp4.api import Satrec

import paho.mqtt.client as mqtt

CELESTRAK_URL = os.getenv('CELESTRAK_URL', 'https://celestrak.org/NORAD/elements/table.php?GROUP=starlink&FORMAT=gp')
MQTT_BROKER = os.getenv('MQTT_BROKER', 'mosquitto')
MQTT_PORT = int(os.getenv('MQTT_PORT', '1883'))
MQTT_PREFIX = os.getenv('MQTT_PREFIX', 'noizymobile/starlink')
REFRESH_INTERVAL = int(os.getenv('REFRESH_INTERVAL', '86400'))

logger = logging.getLogger('sgp4-worker')
logging.basicConfig(level=logging.INFO)

client = mqtt.Client()
client.connect(MQTT_BROKER, MQTT_PORT)


def fetch_gp():
    r = requests.get(CELESTRAK_URL, timeout=30)
    r.raise_for_status()
    return r.text


if __name__ == '__main__':
    logger.info('Starting SGP4 worker, fetching GP data from %s', CELESTRAK_URL)
    while True:
        try:
            gp = fetch_gp()
            # TODO: parse GP/OMM and convert to SGP4 objects; for now publish raw
            topic = f"{MQTT_PREFIX}/orbital/gp_raw"
            client.publish(topic, gp)
            logger.info('Published GP raw to %s', topic)
        except Exception as e:
            logger.exception('sgp4 worker error: %s', e)
        time.sleep(REFRESH_INTERVAL)
