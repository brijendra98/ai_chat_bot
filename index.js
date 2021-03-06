'use strict'
const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const secret = require('./config/secret');
const request = require('request');
const api_ai = require('apiai')(secret.api_ai_client_access_token);
var moment = require('moment');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));

const server = app.listen(process.env.PORT || 3000, () => {
    console.log('Express server listening on port %d in %s mode', server.address().port, app.settings.env);
});

/* For Facebook Validation */
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] && req.query['hub.verify_token'] === secret.fb_token) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.status(403).end();
    }
});


function sendMessage(event) {
    let sender = event.sender.id;
    let text = event.message.text;

    let apiai = api_ai.textRequest(text, {
        sessionId: 'unique_id' // use any arbitrary id
    });

    apiai.on('response', (response) => {
        let aiText = response.result.fulfillment.speech;

        if (response.result.fulfillment.data) {
            let img = response.result.fulfillment.data.facebook.attachment.payload.url;
            let url = response.result.fulfillment.source;
            let subtitle = response.result.fulfillment.displayText;

            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {
                    access_token: secret.PAGE_ACCESS_TOKEN
                },
                method: 'POST',
                json: {
                    recipient: {
                        id: sender
                    },
                    message: {
                        attachment: {
                            type: "template",
                            payload: {
                                template_type: "generic",
                                elements: [{
                                    title: aiText,
                                    image_url: img,
                                    subtitle: subtitle,
                                    default_action: {
                                        type: "web_url",
                                        url: url,
                                        messenger_extensions: true,
                                        webview_height_ratio: "tall",
                                        fallback_url: url
                                    },
                                    buttons: [{
                                        type: "web_url",
                                        url: url,
                                        title: "View Website"
                                    }]
                                }]
                            }
                        }
                    }
                }
            }, (error, response) => {
                if (error) {
                    console.log('Error sending message: ', error);
                } else if (response.body.error) {
                    console.log('Error: ', response.body.error);
                }
            });
        } else {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {
                    access_token: secret.PAGE_ACCESS_TOKEN
                },
                method: 'POST',
                json: {
                    recipient: {
                        id: sender
                    },
                    message: {
                        text: aiText
                    }
                }
            }, (error, response) => {
                if (error) {
                    console.log('Error sending message: ', error);
                } else if (response.body.error) {
                    console.log('Error: ', response.body.error);
                }
            });
        }
    });

    apiai.on('error', (error) => {
        console.log(error);
    });

    apiai.end();
}

/* Handling all messenges */
app.post('/webhook', (req, res) => {
    console.log(req.body);
    if (req.body.object === 'page') {
        req.body.entry.forEach((entry) => {
            entry.messaging.forEach((event) => {
                if (event.message && event.message.text) {
                    sendMessage(event);
                }
            });
        });
        res.status(200).end();
    }
});

/* Handling Ticketmaster events */
app.post('/get_events', (req, res) => {
    if (req.body.result.action === 'events') {
        let address = req.body.result.parameters['address'];

        var options = {
            method: 'GET',
            url: 'https://maps.googleapis.com/maps/api/geocode/json',
            qs: {
                address: address,
                key: secret.google_maps_api_key
            },
            headers: {
                'postman-token': '12bbfc8b-4322-e500-640e-0788bc87bcc8',
                'cache-control': 'no-cache'
            }
        };

        request(options, function(error, response, body) {
            if (error) {
                return res.status(400).json({
                    status: {
                        code: 400,
                        errorType: 'I failed to look up the address.'
                    }
                });
            }
            body = JSON.parse(body);

            var lat = (body.results[0].geometry.viewport.northeast.lat + body.results[0].geometry.viewport.southwest.lat) / 2;
            var lng = (body.results[0].geometry.viewport.northeast.lng + body.results[0].geometry.viewport.southwest.lng) / 2;
            var location = body.results[0].formatted_address;
            var start = moment().format('YYYY-MM-DDTHH:MM:ss');
            var end = moment().add(7, 'days').format('YYYY-MM-DDTHH:MM:ss');

            var options = {
                method: 'GET',
                url: 'https://app.ticketmaster.com/discovery/v2/events.json',
                qs: {
                    apikey: secret.ticketmaster_api_key,
                    latlong: `${lat},${lng}`,
                    startDateTime: `${start}Z`,
                    endDateTime: `${end}Z`,
                },
                headers: {
                    'postman-token': '79a8cda6-7210-b830-e519-9bd8ca142b36',
                    'cache-control': 'no-cache'
                }
            };
            request(options, function(error, response, body) {
                body = JSON.parse(body);
                if (error) {
                    return res.status(400).json({
                        status: {
                            code: 400,
                            errorType: `No events found in ${location}`
                        }
                    });
                }
                var subtitle = `Event happening near ${location} on ${body._embedded.events[0].dates.start.localDate}`;
                var msg = `${body._embedded.events[0].name}`;
                var image = body._embedded.events[0].images[4].url;
                var url = body._embedded.events[0].url;
		url = url.slice(0,4)+'s'+url.slice(4);

                return res.json({
                    speech: msg,
                    displayText: subtitle,
                    source: url,
                    data: {
                        facebook: {
                            attachment: {
                                type: "image",
                                payload: {
                                    url: image
                                }
                            }
                        }
                    }
                });
            });
        });
    }
});
