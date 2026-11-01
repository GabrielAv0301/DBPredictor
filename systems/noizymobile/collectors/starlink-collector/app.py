"""
Starter Starlink collector scaffold.
- Polls a configurable Starlink gRPC host:port
- Normalizes minimal telemetry envelope
- Publishes to MQTT topic prefix (env MQTT_TOPIC_PREFIX)
- TODO: integrate sparky8512/starlink-grpc-tools or native gRPC reflection
"""
import os
import time
import json
import logging

import paho.mqtt.client as mqtt

# Configuration from environment
STARLINK_HOST = os.getenv("STARLINK_HOST", "192.168.100.1")
STARLINK_PORT = int(os.getenv("STARLINK_PORT", "9200"))
MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_PREFIX = os.getenv("MQTT_PREFIX", "noizymobile/starlink")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "10"))

logger = logging.getLogger("collector")
logging.basicConfig(level=logging.INFO)

# Minimal MQTT client
client = mqtt.Client()
client.connect(MQTT_BROKER, MQTT_PORT)


def sample_telemetry():
    # TODO: Replace stub with gRPC call to Starlink terminal using sparky8512/starlink-grpc-tools
    # For now emit a minimal envelope
    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": f"starlink-{STARLINK_HOST}",
        "schema_version": 1,
        "status": {
            "downlink_bps": None,
            "uplink_bps": None,
            "pop_ping_latency_ms": None,
            "uptime_s": None,
        },
        "health": {
            "reachable": False,
            "software_update_state": "unknown",
            "disablement_code": "unknown",
        },
    }


def publish(telemetry):
    topic = f"{MQTT_PREFIX}/status"
    payload = json.dumps(telemetry)
    client.publish(topic, payload)
    logger.info("published to %s", topic)


if __name__ == "__main__":
    logger.info("Starting starlink collector (stub). Polling %s:%s every %ss", STARLINK_HOST, STARLINK_PORT, POLL_INTERVAL)
    while True:
        try:
            t = sample_telemetry()
            publish(t)
        except Exception as e:
            logger.exception("collector error: %s", e)
        time.sleep(POLL_INTERVAL)
