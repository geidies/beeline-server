const _ = require("lodash")
const Joi = require("joi")
const commonmark = require('commonmark')
const ical = require('ical')

const {handleRequestWith, instToJSONOrNotFound, assertFound, deleteInst} = require('../util/endpoints')

export function register (server, options, next) {
  server.route({
    method: "GET",
    path: "/assets",
    config: {
      tags: ["api"],
      auth: false,
    },
    handler: handleRequestWith(
      (ignored, request, {db, models}) => models.Asset.findAll({
        attributes: [
          'id',
          [db.fn('LEFT', db.col('data'), 100), 'preview']
        ]
      })
    ),
  })

  server.route({
    method: "GET",
    path: "/assets/{id}",
    config: {
      tags: ["api"],
      auth: false,
      validate: {
        params: {
          id: Joi.string().required()
        }
      }
    },
    handler: handleRequestWith(
      (ignored, request, {db, models}) => models.Asset.findById(request.params.id),
      instToJSONOrNotFound
    ),
  })

  const reader = new commonmark.Parser({safe: true})
  const writer = new commonmark.HtmlRenderer({safe: true})
  server.route({
    method: "GET",
    path: "/assets/{id}/renderMarkdown",
    config: {
      tags: ["api"],
      auth: false,
      validate: {
        params: {
          id: Joi.string().required()
        }
      }
    },
    handler: handleRequestWith(
      (ignored, request, {db, models}) => models.Asset.findById(request.params.id),
      assertFound,
      asset => reader.parse(asset.data),
      writer.render
    ),
  })

  server.route({
    method: "PUT",
    path: "/assets/{id}",
    config: {
      tags: ["api"],
      auth: {access: {scope: ['superadmin']}},
      validate: {
        params: {
          id: Joi.string().required()
        },
        payload: {
          data: Joi.string().required()
        }
      }
    },
    handler: handleRequestWith(
      (ignored, request, {models}) => models.Asset.findById(request.params.id),
      (asset, request, {models}) => asset
        ? asset.update({ data: request.payload.data })
        : models.Asset.create({ data: request.payload.data, id: request.params.id })
    ),
  })

  server.route({
    method: "DELETE",
    path: "/assets/{id}",
    config: {
      tags: ["api"],
      auth: {access: {scope: ['superadmin']}},
      validate: {
        params: {
          id: Joi.string().required()
        }
      }
    },
    handler: handleRequestWith(
      (ignored, request, {models}) => models.Asset.findById(request.params.id),
      deleteInst
    ),
  })

  server.route({
    method: "GET",
    path: "/publicHolidays",
    config: {
      tags: ["api"],
      plugins: {
        hapiAuthorization: false
      }
    },
    handler: handleRequestWith(
      (ignored, request, {models}) => models.Asset.findById("PublicHoliday"),
      assertFound,
      asset => ical.parseICS(asset.data),
      data => _(data)
        .values()
        .flatMap(({start, end, summary}) => {
          const holidays = []
          const day = 1000 * 60 * 60 * 24
          const endTime = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())

          var startTime = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
          while (startTime < endTime) {
            var holidayDate = new Date(startTime)
            holidays.push({"date": holidayDate, "summary": summary})
            startTime = startTime + day
          }
          return holidays
        })
        .value()
    ),
  })

  next()
}
register.attributes = {
  name: "endpoint-assets"
}
