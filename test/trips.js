var Lab = require("lab")
var lab = exports.lab = Lab.script()
var Code = require("code")

var server = require("../src/index.js")
const {db, models: m} = require("../src/lib/core/dbschema")()
import {loginAs, randomSingaporeLngLat, expectEvent} from './test_common'
import querystring from 'querystring'
import _ from 'lodash'

lab.experiment("Trip manipulation", function () {
  var authHeaders
  var company, route

  lab.before({timeout: 10000}, async () => {
    company = await m.TransportCompany.create({
      name: "XYZ Company"
    })

    route = await m.Route.create({
      description: "Some route",
      transportCompanyId: company.id,
    })

    var response = await loginAs(
      "admin",
      {
        transportCompanyId: company.id,
        permissions: ['manage-routes']
      }
    )

    Code.expect(response.statusCode).to.equal(200)
    authHeaders = {
      authorization: "Bearer " + response.result.sessionToken
    }
  })

  const createStopsTripsUsersTickets = async function (companyId) {
    var stopInstances = await Promise.all(
      _.range(0, 2).map((i) => m.Stop.create({
        description: `Test Stop ${i}`,
        coordinates: {
          type: "Point",
          coordinates: randomSingaporeLngLat()
        }
      }))
    )

    var route = await m.Route.create({
      description: "Some route",
      transportCompanyId: companyId,
    })

    var tripInst = await m.Trip.create({
      date: `2018-03-01`,
      capacity: 10,
      routeId: route.id,
      price: (Math.random() * 3 + 3).toFixed(2),
      tripStops: [
        { stopId: stopInstances[0].id, canBoard: true, canAlight: true, time: `2018-03-01T08:30:00+0800`},
        { stopId: stopInstances[1].id, canBoard: true, canAlight: true, time: `2018-03-01T08:31:00+0800`},
      ],
      bookingInfo: {
        windowType: 'stop',
        windowSize: 0,
      }
    }, {
      include: [m.TripStop]
    })

    // add passengers here
    var userInst = await m.User.create({
      name: 'XXXXXX',
      telephone: `+0000${Date.now()}`
    })
    var ticketInst = await m.Ticket.create({
      boardStopId: tripInst.tripStops[0].id,
      alightStopId: tripInst.tripStops[1].id,
      userId: userInst.id,
      status: 'valid',
    })

    return {stopInstances, tripInst, userInst, ticketInst}
  }

  lab.test("Dates in postgres are coerced to UTC timezone", async function () {
    var result = await db.query(`SELECT '2016-01-01'::date AS a`, {type: db.QueryTypes.SELECT})
    Code.expect(result[0].a.valueOf()).equal(new Date('2016-01-01T00:00:00Z').valueOf())
  })

  lab.test("Get trips", function () {
    return server.inject({
      method: "GET",
      url: "/trips",
      headers: authHeaders
    }).then((resp) => {
      Code.expect(resp.statusCode).to.equal(200)
    })
  })

  lab.test("Add trip", async function () {
    var stops = await Promise.all([
      m.Stop.create({ coordinates: {type: "Point", coordinates: [103.41, 1.38]}, description: "Some stop 1"}),
      m.Stop.create({ coordinates: {type: "Point", coordinates: [103.42, 1.38]}, description: "Some stop 2"}),
      m.Stop.create({ coordinates: {type: "Point", coordinates: [103.42, 1.39]}, description: "Some stop 3"}),
      m.Stop.create({ coordinates: {type: "Point", coordinates: [103.50, 1.40]}, description: "Some stop 4"}),
    ])

    var trip = {
      capacity: 10,
      status: "ACTIVE",
      driverId: null,
      vehicleId: null,
      routeId: route.id,
      price: '3.45',
      date: new Date('2016-02-01').getTime(),

      tripStops: [
        { stopId: stops[0].id, canBoard: true, canAlight: false, time: "2016-02-01T08:00:00+0800"},
        { stopId: stops[1].id, canBoard: true, canAlight: false, time: "2016-02-01T08:06:00+0800"},
        { stopId: stops[2].id, canBoard: true, canAlight: false, time: "2016-02-01T08:03:00+0800"},
        { stopId: stops[3].id, canBoard: false, canAlight: true, time: "2016-02-01T08:09:00+0800"}
      ],
      bookingInfo: {
        windowType: 'stop',
        windowSize: 10000,
        childTicketPrice: '1.00',
      }
    }

    var options = {
      method: "POST",
      url: "/trips",
      payload: trip,
      headers: authHeaders
    }

    var compareResponses = function (a, b) {
      // check object equality...
      Code.expect(a.capacity).to.equal(b.capacity)
      // Code.expect(a.transportCompanyId).to.equal(b.transportCompanyId);
      Code.expect(a.driverId).to.equal(b.driverId)
      Code.expect(a.vehicleId).to.equal(b.vehicleId)
      Code.expect(a.price).to.equal(b.price)
      Code.expect(a.status).to.equal(b.status)
      Code.expect(a.tripStops.length).to.equal(b.tripStops.length)
      Code.expect(new Date(a.date).getTime()).to.equal(b.date)

      Code.expect(a.seatsAvailable).to.equal(b.capacity)

      for (var i = 0; i < 4; i++) {
        Code.expect(a.tripStops.filter((ts) => {
          return ts.stopId === b.tripStops[i].stopId
        }).length).to.equal(1)
      }
    }

    var postResponse = await server.inject(options)

    Code.expect(postResponse.statusCode).to.equal(200)
    // check object equality...
    Code.expect(postResponse.result).to.include("id")
    compareResponses(postResponse.result, trip)

    var getResponse = await server.inject({
      method: "GET",
      url: "/trips/" + postResponse.result.id,
      headers: authHeaders
    })

    // ensure that with the GET, the stops are returned in sorted order
    for (let i = 0; i < getResponse.result.tripStops.length - 1; i++) {
      var thisStop = getResponse.result.tripStops[i]
      var nextStop = getResponse.result.tripStops[i + 1]

      Code.expect(new Date(thisStop.time).getTime())
        .to.be.lessThan(new Date(nextStop.time).getTime())
    }

    Code.expect(getResponse.statusCode).to.equal(200)
    // check object equality...
    Code.expect(getResponse.result).to.include("id")
    compareResponses(getResponse.result, trip)

    // Check trip PUT
    var putResponse = await server.inject({
      method: 'PUT',
      url: `/trips/${getResponse.result.id}`,
      headers: authHeaders,
      payload: _.omit(_.defaults({
        bookingInfo: {
          childTicketPrice: '2.00',
          windowType: 'firstStop',
          windowSize: 30000,
        },
        tripStops: getResponse.result.tripStops
      }, trip), ['routeId', 'date'])
    })
    Code.expect(putResponse.result.bookingInfo.childTicketPrice).equal(2)
    Code.expect(putResponse.result.bookingInfo.windowType).equal('firstStop')
    Code.expect(putResponse.result.bookingInfo.windowSize).equal(30000)

    var deleteResponse = await server.inject({
      method: "DELETE",
      url: "/trips/" + getResponse.result.id,
      headers: authHeaders
    })

    Code.expect(deleteResponse.statusCode).to.equal(200)
  })

  const testCapacityChange = options => async function () {
    const {tripInst} = await createStopsTripsUsersTickets(company.id)

    const initialCapacity = tripInst.capacity
    const initialSeatsAvailable = options.initialSeatsAvailable
    const capacityChange = options.capacityChange

    await m.Trip.update(
      { seatsAvailable: initialSeatsAvailable },
      { where: { id: tripInst.id } }
    )

    var payload = _.omit(
      _.defaults(
        { capacity: initialCapacity + capacityChange },
        tripInst.get({ plain: true })
      ),
      [
        'routeId', 'date', 'availability', 'priceF', 'isRunning',
        'id', 'createdAt', 'updatedAt', 'seatsAvailable', 'transportCompanyId'
      ]
    )
    var putResponse = await server.inject({
      method: 'PUT',
      url: `/trips/${tripInst.id}`,
      headers: authHeaders,
      payload: payload,
    })
    Code.expect(putResponse.statusCode).equal(options.statusCode)
    if (options.statusCode === 200) {
      Code.expect(putResponse.result.capacity).equal(initialCapacity + capacityChange)
      Code.expect(putResponse.result.seatsAvailable).equal(options.expectedSeatsAvailable)

      const trip = await m.Trip.findById(tripInst.id)

      Code.expect(trip.capacity).equal(initialCapacity + capacityChange)
      Code.expect(trip.seatsAvailable).equal(options.expectedSeatsAvailable)
    }
  }

  lab.test(
    'Capacity increase should increase seatsAvailable',
    testCapacityChange({
      initialSeatsAvailable: 8, capacityChange: 5,
      statusCode: 200, expectedSeatsAvailable: 13
    })
  )

  lab.test(
    'Capacity decrease < seatsAvailable -> seatsAvailable > 0',
    testCapacityChange({
      initialSeatsAvailable: 8, capacityChange: -3,
      statusCode: 200, expectedSeatsAvailable: 5
    })
  )

  lab.test(
    'Capacity decrease > seatsAvailable -> Error',
    testCapacityChange({
      initialSeatsAvailable: 1, capacityChange: -2,
      statusCode: 400, expectedSeatsAvailable: 0
    })
  )

  lab.test(
    'Cannot change trip date unless there are no bookings',
    async function (done) {
      const {tripInst, ticketInst} =
        await createStopsTripsUsersTickets(company.id)

      // Check that changing the date would fail
      const newDate = Date.UTC(2018, 1, 1, 0, 0, 0)
      const diff = newDate - tripInst.date.getTime()

      const payloadWithDate = {
        date: new Date(newDate),
        capacity: tripInst.capacity,
        tripStops: (await tripInst.getTripStops({raw: true}))
          .map(ts => ({
            ...ts,
            time: new Date(ts.time.getTime() + diff)
          }))
      }

      const putResponse = await server.inject({
        method: 'PUT',
        url: `/trips/${tripInst.id}`,
        headers: authHeaders,
        payload: payloadWithDate,
      })

      Code.expect(putResponse.statusCode).equal(400)

      await ticketInst.destroy()

      const putResponse2 = await server.inject({
        method: 'PUT',
        url: `/trips/${tripInst.id}`,
        headers: authHeaders,
        payload: payloadWithDate,
      })

      Code.expect(putResponse2.statusCode).equal(200)
    }
  )

  lab.test('Message passengers', async function () {
    const {tripInst} = await createStopsTripsUsersTickets(company.id)

    var adminCreds = await loginAs('admin', {
      transportCompanyId: company.id,
      permissions: ['message-passengers']
    })
    var ev = expectEvent('passengersMessaged', {routeIds: [tripInst.routeId]})
    var adminSendResponse = await server.inject({
      method: 'POST',
      url: `/trips/${tripInst.id}/messagePassengers?dryRun=true`,
      headers: {
        Authorization: `Bearer ${adminCreds.result.sessionToken}`
      },
      payload: {
        message: 'This is a test run'
      }
    })
    Code.expect(adminSendResponse.statusCode).equal(200)
    await ev.check()

    var superadminCreds = await loginAs('superadmin')
    var superadminSendResponse = await server.inject({
      method: 'POST',
      url: `/trips/${tripInst.id}/messagePassengers?dryRun=true`,
      headers: {
        Authorization: `Bearer ${superadminCreds.result.sessionToken}`
      },
      payload: {
        message: 'This is a test run'
      }
    })
    Code.expect(superadminSendResponse.statusCode).equal(200)
  })

  lab.test('Messages should be from BeelineSG by default', async function () {
    const {tripInst} = await createStopsTripsUsersTickets(company.id)

    const messageCapture = {}
    await tripInst.messagePassengers('This is a test run', {
      smsFunc: x => {
        messageCapture.message = x
      }
    })

    Code.expect(messageCapture.message.from).equal('BeelineSG')
  })

  lab.test('Messages should be from operator code if available', async function () {
    const smsOpCode = 'XYZCO'
    var smsCompany = await m.TransportCompany.create({
      name: "XYZ Company",
      smsOpCode: smsOpCode,
    })
    const {tripInst} = await createStopsTripsUsersTickets(smsCompany.id)

    const messageCapture = {}
    await tripInst.messagePassengers('This is a test run', {
      smsFunc: x => {
        messageCapture.message = x
      }
    })

    Code.expect(messageCapture.message.from).equal(smsOpCode)
  })

  lab.test('Querying ticket report by date enforces UTC midnight', async function () {
    const {ticketInst} = await createStopsTripsUsersTickets(company.id)

    await m.Transaction.create({
      committed: true,
      transactionItems: [
        {itemType: 'ticketSale', itemId: ticketInst.id, credit: 0}
      ]
    }, {
      include: [m.TransactionItem]
    })

    var adminCreds = await loginAs('admin', {
      transportCompanyId: company.id,
      permissions: ['view-transactions']
    })
    var headers = {
      authorization: `Bearer ${adminCreds.result.sessionToken}`
    }

    // Get the ticket reports
    // Dates OK
    var defaultQuery = {
      perPage: 100,
      page: 1,
      orderBy: 'createdAt',
      order: 'desc',
      tripStartDate: new Date('2018-03-01').getTime(),
      tripEndDate: new Date('2018-03-02').getTime(),
      statuses: JSON.stringify(['valid'])
    }
    var ticketReport = await server.inject({
      method: 'GET',
      url: '/custom/wrs/report?' + querystring.stringify(defaultQuery),
      headers
    })
    Code.expect(ticketReport.statusCode).equal(200)
    Code.expect(ticketReport.result.rows[0].id).equal(ticketInst.id)

    // Dates not OK
    ticketReport = await server.inject({
      method: 'GET',
      url: '/custom/wrs/report?' + querystring.stringify(
        _.defaults({
          tripStartDate: new Date('2018-03-01T00:00:00+0800').getTime()
        }, defaultQuery)),
      headers
    })
    Code.expect(ticketReport.statusCode).equal(400)
  })

  lab.test('CSV reporting works', async function () {
    const {ticketInst} = await createStopsTripsUsersTickets(company.id)

    await m.Transaction.create({
      committed: true,
      transactionItems: [
        {itemType: 'ticketSale', itemId: ticketInst.id, credit: 0}
      ]
    }, {
      include: [m.TransactionItem]
    })

    var adminCreds = await loginAs('admin', {
      transportCompanyId: company.id,
      permissions: ['view-transactions']
    })
    var headers = {
      authorization: `Bearer ${adminCreds.result.sessionToken}`
    }

    // Get the ticket reports
    // Dates OK
    var defaultQuery = {
      perPage: 100,
      page: 1,
      orderBy: 'createdAt',
      order: 'desc',
      tripStartDate: new Date('2018-03-01').getTime(),
      tripEndDate: new Date('2018-03-02').getTime(),
      statuses: JSON.stringify(['valid']),
      format: 'csv',
    }
    var ticketReport = await server.inject({
      method: 'GET',
      url: '/custom/wrs/report?' + querystring.stringify(defaultQuery),
      headers
    })
    Code.expect(ticketReport.headers['content-type']).startsWith('text/csv')
    Code.expect(ticketReport.statusCode).equal(200)
    Code.expect(ticketReport.result.split('\n').length).least(3)
  })

  lab.test("Tickets should not be cascade deletable", async function () {
    const {tripInst} = await createStopsTripsUsersTickets(company.id)

    await tripInst.destroy()
      .then(() => {
        Code.fail("Trip instance should not have been successfully destroyed")
      }, () => {
        console.log('Test passed: ticket prevented trip destruction')
      })
  })

  lab.test("Invalid trip GET request -> 404", async function () {
    const response = await server.inject({
      method: 'GET',
      url: '/trips/44444444',
    })

    Code.expect(response.statusCode).equal(404)
  })

  lab.test("Invalid trip DELETE request -> 404", async function () {
    var adminCreds = await loginAs('admin', {
      transportCompanyId: company.id,
      permissions: ['manage-routes']
    })
    var headers = {
      authorization: `Bearer ${adminCreds.result.sessionToken}`
    }
    const response = await server.inject({
      method: 'DELETE',
      url: '/trips/44444444',
      headers,
    })

    Code.expect(response.statusCode).equal(404)
  })
})
